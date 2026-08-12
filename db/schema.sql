-- ============================================================================
--  ITSchool — схема базы данных для Supabase
--  Выполните этот файл целиком в разделе SQL Editor вашего проекта Supabase.
--  Скрипт можно запускать повторно: он не ломает уже существующие данные.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  1. Профили пользователей
--     Создаются автоматически при регистрации. Доступ к закрытым материалам
--     даёт флаг approved, который выставляет администратор.
-- ----------------------------------------------------------------------------

create table if not exists public.profiles (
    id          uuid primary key references auth.users on delete cascade,
    email       text,
    full_name   text,
    role        text not null default 'student' check (role in ('student', 'admin')),
    approved    boolean not null default false,
    note        text,                       -- заметка репетитора об ученике
    created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Ученики и администраторы. approved = есть доступ к закрытым урокам.';


-- ----------------------------------------------------------------------------
--  2. Лекционные материалы
-- ----------------------------------------------------------------------------

create table if not exists public.lectures (
    id            uuid primary key default gen_random_uuid(),
    title         text not null,
    summary       text,                     -- короткое описание для карточки
    description   text,                     -- полное описание урока
    cover_url     text,                     -- публичная ссылка на обложку
    video_url     text,                     -- ссылка на YouTube / VK / Rutube / файл
    archive_path  text,                     -- путь к zip внутри бакета materials
    archive_name  text,                     -- исходное имя файла
    archive_size  bigint,
    links         jsonb not null default '[]'::jsonb,  -- [{ "title": "...", "url": "..." }]
    tags          text[] not null default '{}',
    level         text not null default 'basic' check (level in ('basic', 'medium', 'advanced')),
    duration_min  integer,
    is_free       boolean not null default false,       -- виден всем без входа
    published     boolean not null default false,       -- черновик не виден никому, кроме админа
    views         integer not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists lectures_published_idx on public.lectures (published, created_at desc);
create index if not exists lectures_tags_idx      on public.lectures using gin (tags);

-- Обновление updated_at при любом изменении
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists lectures_touch_updated_at on public.lectures;
create trigger lectures_touch_updated_at
    before update on public.lectures
    for each row execute function public.touch_updated_at();


-- ----------------------------------------------------------------------------
--  3. Вспомогательные функции прав
--     security definer — чтобы политики на profiles не вызывали рекурсию.
-- ----------------------------------------------------------------------------

-- Права администратора требуют подтверждённой сессии (aal2), если у него
-- подключён двухфакторный вход. Без этой проверки MFA был бы бесполезен:
-- сессия, не прошедшая второй шаг, остаётся полноценной.
-- Условие «или факторов нет» защищает от блокировки: пока приложение-
-- аутентификатор не подключено, вход работает как обычно.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
    )
    and (
        coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
        or not exists (
            select 1 from auth.mfa_factors
            where user_id = auth.uid() and status = 'verified'
        )
    );
$$;

create or replace function public.has_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and (approved or role = 'admin')
    );
$$;


-- ----------------------------------------------------------------------------
--  4. Автоматическое создание профиля при регистрации
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, full_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', '')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- ----------------------------------------------------------------------------
--  5. Политики доступа (RLS)
--     Это единственная защита данных: ключ anon публичный, поэтому все
--     ограничения обязаны жить здесь, на стороне базы.
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.lectures enable row level security;

-- Профили: свой видит каждый, все — только администратор
drop policy if exists "profiles: читать свой или все админу" on public.profiles;
create policy "profiles: читать свой или все админу"
    on public.profiles for select
    using (id = auth.uid() or public.is_admin());

-- Менять роль и доступ может только администратор.
-- Обычный пользователь не может редактировать себя вообще — иначе он
-- смог бы сам выставить approved = true.
drop policy if exists "profiles: изменять может админ" on public.profiles;
create policy "profiles: изменять может админ"
    on public.profiles for update
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "profiles: удалять может админ" on public.profiles;
create policy "profiles: удалять может админ"
    on public.profiles for delete
    using (public.is_admin());

-- Лекции: полную карточку (включая ссылку на видео и файлы) получает
-- только тот, кому она доступна.
drop policy if exists "lectures: читать доступные" on public.lectures;
create policy "lectures: читать доступные"
    on public.lectures for select
    using (
        public.is_admin()
        or (published and (is_free or public.has_access()))
    );

drop policy if exists "lectures: создавать может админ" on public.lectures;
create policy "lectures: создавать может админ"
    on public.lectures for insert
    with check (public.is_admin());

drop policy if exists "lectures: изменять может админ" on public.lectures;
create policy "lectures: изменять может админ"
    on public.lectures for update
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "lectures: удалять может админ" on public.lectures;
create policy "lectures: удалять может админ"
    on public.lectures for delete
    using (public.is_admin());


-- ----------------------------------------------------------------------------
--  6. Витрина каталога
--     Гость должен видеть, что урок существует (обложка, название, описание),
--     но не должен получать ссылку на видео и файлы. Представление отдаёт
--     только безопасные поля и поэтому доступно всем.
-- ----------------------------------------------------------------------------

create or replace view public.lectures_catalog as
    select id, title, summary, cover_url, tags, level,
           duration_min, is_free, views, created_at,
           (video_url is not null and video_url <> '') as has_video,
           (archive_path is not null)                  as has_files
    from public.lectures
    where published;

comment on view public.lectures_catalog is
    'Публичная витрина: только безопасные поля. Ссылки на видео и файлы отдаёт таблица lectures под RLS.';

-- ВАЖНО: представление работает от имени владельца и поэтому не подчиняется RLS —
-- иначе гость не увидел бы карточки закрытых уроков. Побочный эффект: Postgres
-- считает такое представление изменяемым, а Supabase по умолчанию раздаёт роли
-- anon права на всё в схеме public. В сумме это позволило бы писать в lectures
-- в обход политик, поэтому все права снимаются и возвращается только чтение.
revoke all on public.lectures_catalog from anon, authenticated;
grant select on public.lectures_catalog to anon, authenticated;


-- ----------------------------------------------------------------------------
--  7. Счётчик просмотров
-- ----------------------------------------------------------------------------

create or replace function public.increment_views(lecture_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
    update public.lectures set views = views + 1 where id = lecture_id and published;
$$;

grant execute on function public.increment_views(uuid) to anon, authenticated;


-- Удаление учётных записей.
-- Стереть запись из auth.users может только владелец схемы (postgres),
-- поэтому функция объявлена security definer. Внутри проверяем, что вызвал
-- администратор (is_admin() требует подтверждённую сессию), и защищаем
-- администраторов от удаления. Профиль ученика удалится каскадом по внешнему
-- ключу. Возвращаем число фактически удалённых записей.
create or replace function public.admin_delete_users(targets uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    deleted integer;
begin
    if not public.is_admin() then
        raise exception 'Только администратор может удалять пользователей';
    end if;

    delete from auth.users u
    where u.id = any(targets)
      and not exists (
          select 1 from public.profiles p
          where p.id = u.id and p.role = 'admin'
      );

    get diagnostics deleted = row_count;
    return deleted;
end;
$$;

grant execute on function public.admin_delete_users(uuid[]) to authenticated;


-- ----------------------------------------------------------------------------
--  8. Хранилище файлов
--     covers    — обложки, публичный бакет (картинки открыты всем)
--     materials — zip-архивы, закрытый бакет: ссылки выдаются на время
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do update
    set public = true,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', false, 52428800)   -- 50 МБ: лимит бесплатного тарифа
on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit;

-- Обложки: читают все, загружает администратор
drop policy if exists "covers: читают все" on storage.objects;
create policy "covers: читают все"
    on storage.objects for select
    using (bucket_id = 'covers');

drop policy if exists "covers: загружает админ" on storage.objects;
create policy "covers: загружает админ"
    on storage.objects for insert
    with check (bucket_id = 'covers' and public.is_admin());

drop policy if exists "covers: изменяет админ" on storage.objects;
create policy "covers: изменяет админ"
    on storage.objects for update
    using (bucket_id = 'covers' and public.is_admin());

drop policy if exists "covers: удаляет админ" on storage.objects;
create policy "covers: удаляет админ"
    on storage.objects for delete
    using (bucket_id = 'covers' and public.is_admin());

-- Материалы: скачивает тот, у кого есть доступ, либо любой — если файл
-- прикреплён к опубликованному бесплатному уроку.
drop policy if exists "materials: скачивают допущенные" on storage.objects;
create policy "materials: скачивают допущенные"
    on storage.objects for select
    using (
        bucket_id = 'materials'
        and (
            public.has_access()
            or exists (
                select 1 from public.lectures l
                where l.published and l.is_free and l.archive_path = storage.objects.name
            )
        )
    );

drop policy if exists "materials: загружает админ" on storage.objects;
create policy "materials: загружает админ"
    on storage.objects for insert
    with check (bucket_id = 'materials' and public.is_admin());

drop policy if exists "materials: изменяет админ" on storage.objects;
create policy "materials: изменяет админ"
    on storage.objects for update
    using (bucket_id = 'materials' and public.is_admin());

drop policy if exists "materials: удаляет админ" on storage.objects;
create policy "materials: удаляет админ"
    on storage.objects for delete
    using (bucket_id = 'materials' and public.is_admin());


-- ============================================================================
--  ПОСЛЕДНИЙ ШАГ — назначить себя администратором.
--  Сначала зарегистрируйтесь на сайте через страницу «Войти»,
--  затем выполните запрос ниже, подставив свою почту:
--
--      update public.profiles
--      set role = 'admin', approved = true
--      where email = 'ваша-почта@example.com';
-- ============================================================================
