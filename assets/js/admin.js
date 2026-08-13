/* ==========================================================================
   Панель управления: добавление уроков и доступ учеников.
   Все операции защищены политиками RLS — страница лишь удобный интерфейс.
   ========================================================================== */

import {
    sb, isConfigured, requireAuth, configWarning,
    escapeHtml, formatBytes, formatDate, showMsg, hideMsg, LEVELS,
} from './app.js?v=4';
import { BUCKET_COVERS, BUCKET_MATERIALS } from './config.js?v=4';
import { mergeContent } from './content.js?v=4';

const guard = document.getElementById('admin-guard');
const panel = document.getElementById('admin');
const form = document.getElementById('lecture-form');
const message = document.getElementById('editor-message');
const saveBtn = document.getElementById('save-btn');
const editorTitle = document.getElementById('editor-title');
const coverPreview = document.getElementById('cover-preview');
const archiveHint = document.getElementById('archive-current');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');

let lectures = [];
let editing = null;

/* --------------------------------------------------------- Запуск */

(async function start() {
    if (!isConfigured) {
        guard.innerHTML = configWarning();
        return;
    }

    const state = await requireAuth({ admin: true });
    if (!state) {
        // Гостя уже перебросило на вход; сюда попадает только вошедший без прав.
        guard.innerHTML = `<div class="card center">
            <h2 style="font-size:1.4rem;">Панель доступна только администратору</h2>
            <p class="muted">Вы вошли под учебной записью ученика. Материалы курса — в разделе «Материалы».</p>
            <a class="btn btn-outline" href="lectures.html">К материалам</a>
        </div>`;
        return;
    }

    guard.hidden = true;
    panel.hidden = false;
    myId = state.user.id;

    await Promise.all([loadLectures(), loadStudents(), loadMfa(), loadSiteContent()]);
})();

/** id вошедшего администратора — чтобы не дать разжаловать самого себя. */
let myId = null;

/* --------------------------------------------------------- Вкладки */

document.querySelectorAll('.tab[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => openTab(tab.dataset.tab));
});

function openTab(name) {
    document.querySelectorAll('.tab[data-tab]')
        .forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel')
        .forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
}

/* --------------------------------------------------------- Список уроков */

async function loadLectures() {
    const { data, error } = await sb
        .from('lectures')
        .select('*')
        .order('created_at', { ascending: false });

    const rows = document.getElementById('lectures-rows');
    if (error) {
        rows.innerHTML = `<tr><td colspan="5">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
        return;
    }

    lectures = data ?? [];
    document.getElementById('tab-count').textContent = `(${lectures.length})`;
    renderTagList();

    if (!lectures.length) {
        rows.innerHTML = '<tr><td colspan="5" class="muted">Пока ни одного урока — добавьте первый на соседней вкладке.</td></tr>';
        return;
    }

    rows.innerHTML = lectures.map(item => `
        <tr>
            <td>
                <strong>${escapeHtml(item.title)}</strong><br>
                <span class="muted" style="font-size:.85rem;">
                    ${LEVELS[item.level] ?? ''} · ${formatDate(item.created_at)}
                    ${(item.tags ?? []).length ? ' · ' + escapeHtml(item.tags.join(', ')) : ''}
                </span>
            </td>
            <td><span class="status-dot ${item.published ? 'status-ok' : 'status-off'}">
                ${item.published ? 'Опубликован' : 'Черновик'}</span></td>
            <td>${item.is_free ? 'Открытый' : 'Для учеников'}</td>
            <td>${item.views ?? 0}</td>
            <td>
                <div class="row-actions">
                    <button class="btn btn-sm btn-ghost" data-edit="${item.id}">Изменить</button>
                    <button class="btn btn-sm btn-ghost" data-toggle="${item.id}">
                        ${item.published ? 'Снять' : 'Опубликовать'}</button>
                    <button class="btn btn-sm btn-danger" data-delete="${item.id}">Удалить</button>
                </div>
            </td>
        </tr>`).join('');
}

document.getElementById('lectures-rows').addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;

    if (button.dataset.edit) startEdit(button.dataset.edit);
    if (button.dataset.toggle) await togglePublished(button.dataset.toggle);
    if (button.dataset.delete) await removeLecture(button.dataset.delete);
});

async function togglePublished(id) {
    const item = lectures.find(l => l.id === id);
    const { error } = await sb.from('lectures')
        .update({ published: !item.published })
        .eq('id', id);

    if (error) alert(`Не получилось: ${error.message}`);
    await loadLectures();
}

async function removeLecture(id) {
    const item = lectures.find(l => l.id === id);
    if (!confirm(`Удалить урок «${item.title}»? Видео на площадке останется, файлы с сайта будут стёрты.`)) return;

    await removeStoredFiles(item);

    const { error } = await sb.from('lectures').delete().eq('id', id);
    if (error) alert(`Не получилось удалить: ${error.message}`);

    if (editing === id) resetForm();
    await loadLectures();
}

async function removeStoredFiles(item, { cover = true, archive = true } = {}) {
    if (cover && item.cover_url) {
        const path = coverPathFromUrl(item.cover_url);
        if (path) await sb.storage.from(BUCKET_COVERS).remove([path]);
    }
    if (archive && item.archive_path) {
        await sb.storage.from(BUCKET_MATERIALS).remove([item.archive_path]);
    }
}

function coverPathFromUrl(url) {
    const marker = `/${BUCKET_COVERS}/`;
    const index = url.indexOf(marker);
    return index === -1 ? null : decodeURIComponent(url.slice(index + marker.length));
}

/* --------------------------------------------------------- Редактор */

function startEdit(id) {
    const item = lectures.find(l => l.id === id);
    if (!item) return;

    editing = id;
    editorTitle.textContent = 'Редактирование урока';
    saveBtn.textContent = 'Сохранить изменения';

    form.elements.id.value = item.id;
    form.elements.title.value = item.title ?? '';
    form.elements.summary.value = item.summary ?? '';
    form.elements.description.value = item.description ?? '';
    form.elements.video_url.value = item.video_url ?? '';
    form.elements.tags.value = (item.tags ?? []).join(', ');
    form.elements.level.value = item.level ?? 'basic';
    form.elements.duration_min.value = item.duration_min ?? '';
    form.elements.links.value = (Array.isArray(item.links) ? item.links : [])
        .map(link => `${link.title ?? ''} | ${link.url ?? ''}`).join('\n');
    form.elements.is_free.checked = Boolean(item.is_free);
    form.elements.published.checked = Boolean(item.published);
    form.elements.cover.value = '';
    form.elements.archive.value = '';

    coverPreview.classList.toggle('show', Boolean(item.cover_url));
    if (item.cover_url) coverPreview.src = item.cover_url;

    archiveHint.textContent = item.archive_path
        ? `Сейчас загружен: ${item.archive_name} (${formatBytes(item.archive_size)}). Выберите новый файл, чтобы заменить.`
        : 'ZIP, RAR, 7Z, PDF, DOC, DOCX — до 50 МБ на бесплатном тарифе Supabase.';

    hideMsg(message);
    openTab('editor');
    scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
    editing = null;
    form.reset();
    form.elements.published.checked = true;
    editorTitle.textContent = 'Новый урок';
    saveBtn.textContent = 'Сохранить урок';
    coverPreview.classList.remove('show');
    archiveHint.textContent = 'ZIP, RAR, 7Z, PDF, DOC, DOCX — до 50 МБ на бесплатном тарифе Supabase.';
    hideMsg(message);
}

document.getElementById('reset-btn').addEventListener('click', resetForm);

form.elements.cover.addEventListener('change', () => {
    const file = form.elements.cover.files[0];
    if (!file) return;
    coverPreview.src = URL.createObjectURL(file);
    coverPreview.classList.add('show');
});

function renderTagList() {
    const tags = [...new Set(lectures.flatMap(l => l.tags ?? []))].sort((a, b) => a.localeCompare(b, 'ru'));
    document.getElementById('tag-list').innerHTML =
        tags.map(tag => `<option value="${escapeHtml(tag)}">`).join('');
}

/* --------------------------------------------------------- Сохранение */

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = form.elements.title.value.trim();
    if (!title) {
        showMsg(message, 'Укажите название урока.', 'err');
        return;
    }

    saveBtn.disabled = true;
    progress.classList.add('show');
    setProgress(10);

    try {
        const current = editing ? lectures.find(l => l.id === editing) : null;
        const payload = {
            title,
            summary: form.elements.summary.value.trim() || null,
            description: form.elements.description.value.trim() || null,
            video_url: form.elements.video_url.value.trim() || null,
            tags: parseTags(form.elements.tags.value),
            level: form.elements.level.value,
            duration_min: Number(form.elements.duration_min.value) || null,
            links: parseLinks(form.elements.links.value),
            is_free: form.elements.is_free.checked,
            published: form.elements.published.checked,
        };

        const coverFile = form.elements.cover.files[0];
        if (coverFile) {
            showMsg(message, 'Загружаем обложку...', 'info');
            payload.cover_url = await uploadCover(coverFile);
            setProgress(45);
            if (current?.cover_url) await removeStoredFiles(current, { archive: false });
        }

        const archiveFile = form.elements.archive.files[0];
        if (archiveFile) {
            showMsg(message, 'Загружаем материалы к занятию...', 'info');
            const stored = await uploadArchive(archiveFile);
            Object.assign(payload, stored);
            setProgress(80);
            if (current?.archive_path) await removeStoredFiles(current, { cover: false });
        }

        showMsg(message, 'Сохраняем урок...', 'info');
        const query = editing
            ? sb.from('lectures').update(payload).eq('id', editing)
            : sb.from('lectures').insert(payload);

        const { error } = await query;
        if (error) throw error;

        setProgress(100);
        showMsg(message, editing ? 'Изменения сохранены.' : 'Урок добавлен и появился в каталоге.', 'ok');
        resetForm();
        await loadLectures();
    } catch (error) {
        showMsg(message, `Не получилось сохранить: ${error.message ?? error}`, 'err');
    } finally {
        saveBtn.disabled = false;
        setTimeout(() => {
            progress.classList.remove('show');
            setProgress(0);
        }, 900);
    }
});

function setProgress(percent) {
    progressBar.style.width = `${percent}%`;
}

async function uploadCover(file) {
    const path = `${uid()}.${extension(file.name) || 'jpg'}`;
    const { error } = await sb.storage.from(BUCKET_COVERS)
        .upload(path, file, { cacheControl: '31536000', upsert: false });
    if (error) throw new Error(`обложка — ${error.message}`);

    const { data } = sb.storage.from(BUCKET_COVERS).getPublicUrl(path);
    return data.publicUrl;
}

async function uploadArchive(file) {
    const path = `${uid()}/${safeName(file.name)}`;
    const { error } = await sb.storage.from(BUCKET_MATERIALS)
        .upload(path, file, { upsert: false });
    if (error) throw new Error(`материалы — ${error.message}`);

    return { archive_path: path, archive_name: file.name, archive_size: file.size };
}

/* --------------------------------------------------------- Ученики */

let students = [];
const selected = new Set();

async function loadStudents() {
    const { data, error } = await sb
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

    const rows = document.getElementById('students-rows');
    if (error) {
        rows.innerHTML = `<tr><td colspan="6">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
        return;
    }

    students = data ?? [];
    // Выбор сбрасываем на удалённых/исчезнувших учениках
    for (const id of [...selected]) {
        if (!students.some(s => s.id === id)) selected.delete(id);
    }

    const waiting = students.filter(s => s.role !== 'admin' && !s.approved).length;
    document.getElementById('tab-students').textContent = waiting ? `(${waiting} ждут)` : `(${students.length})`;

    renderStudents();
}

/** Порядок строк по выбранному критерию. Администраторы всегда сверху. */
function sortedStudents() {
    const mode = document.getElementById('students-sort').value;
    const comparators = {
        new: (a, b) => new Date(b.created_at) - new Date(a.created_at),
        old: (a, b) => new Date(a.created_at) - new Date(b.created_at),
        name: (a, b) => (a.full_name || 'я').localeCompare(b.full_name || 'я', 'ru'),
        waiting: (a, b) => Number(a.approved) - Number(b.approved) || new Date(b.created_at) - new Date(a.created_at),
        approved: (a, b) => Number(b.approved) - Number(a.approved) || new Date(b.created_at) - new Date(a.created_at),
    };
    return [...students].sort((a, b) =>
        Number(b.role === 'admin') - Number(a.role === 'admin')
        || (comparators[mode] ?? comparators.new)(a, b));
}

function renderStudents() {
    const rows = document.getElementById('students-rows');
    const list = sortedStudents();

    document.getElementById('students-count').textContent =
        `${students.length} ${plural(students.length, 'ученик', 'ученика', 'учеников')}`;

    if (!students.length) {
        rows.innerHTML = '<tr><td colspan="6" class="muted">Пока никто не зарегистрировался.</td></tr>';
        updateBulkBar();
        return;
    }

    rows.innerHTML = list.map(person => {
        const isAdmin = person.role === 'admin';
        const checkbox = isAdmin
            ? ''
            : `<input type="checkbox" class="student-check" data-id="${person.id}"
                 ${selected.has(person.id) ? 'checked' : ''} aria-label="Выбрать">`;

        // У администраторов вместо строки действий — либо пометка «это вы»,
        // либо кнопка снять права (себя разжаловать нельзя: иначе можно
        // остаться совсем без администраторов).
        const adminActions = person.id === myId
            ? '<span class="muted" style="font-size:.85rem;">это вы</span>'
            : `<button class="btn btn-sm btn-danger" data-demote="${person.id}"
                 data-name="${escapeHtml(person.full_name || person.email || '')}">Снять права админа</button>`;

        const actions = isAdmin ? adminActions : `
            <div class="row-actions">
                <button class="btn btn-sm ${person.approved ? 'btn-danger' : 'btn-outline'}"
                    data-approve="${person.id}" data-value="${person.approved ? '0' : '1'}">
                    ${person.approved ? 'Закрыть доступ' : 'Открыть доступ'}
                </button>
                <button class="btn btn-sm btn-ghost"
                    data-reset="${escapeHtml(person.email ?? '')}">Сбросить пароль</button>
                <button class="btn btn-sm btn-danger"
                    data-delete="${person.id}" data-name="${escapeHtml(person.full_name || person.email || '')}">Удалить</button>
            </div>`;

        return `<tr${selected.has(person.id) ? ' style="background:#f4fbf5;"' : ''}>
            <td>${checkbox}</td>
            <td><strong>${escapeHtml(person.full_name || 'Без имени')}</strong>
                ${isAdmin ? '<br><span class="tag">администратор</span>' : ''}</td>
            <td>${escapeHtml(person.email ?? '')}</td>
            <td>${formatDate(person.created_at)}</td>
            <td><span class="status-dot ${person.approved ? 'status-ok' : 'status-off'}">
                ${person.approved ? 'Открыт' : 'Закрыт'}</span></td>
            <td>${actions}</td>
        </tr>`;
    }).join('');

    syncCheckAll();
    updateBulkBar();
}

/* --------------------------------------------------------- Выбор */

function selectableIds() {
    return students.filter(s => s.role !== 'admin').map(s => s.id);
}

function syncCheckAll() {
    const all = selectableIds();
    const box = document.getElementById('check-all');
    box.checked = all.length > 0 && all.every(id => selected.has(id));
    box.indeterminate = !box.checked && all.some(id => selected.has(id));
}

function updateBulkBar() {
    const bar = document.getElementById('bulk-bar');
    bar.hidden = selected.size === 0;
    document.getElementById('bulk-count').textContent =
        `Выбрано: ${selected.size} ${plural(selected.size, 'ученик', 'ученика', 'учеников')}`;
}

document.getElementById('students-sort').addEventListener('change', renderStudents);

document.getElementById('check-all').addEventListener('change', (e) => {
    const ids = selectableIds();
    if (e.target.checked) ids.forEach(id => selected.add(id));
    else ids.forEach(id => selected.delete(id));
    renderStudents();
});

document.getElementById('students-rows').addEventListener('change', (e) => {
    const check = e.target.closest('.student-check');
    if (!check) return;
    if (check.checked) selected.add(check.dataset.id);
    else selected.delete(check.dataset.id);
    // Подсветку строки и панель обновляем без полной перерисовки
    check.closest('tr').style.background = check.checked ? '#f4fbf5' : '';
    syncCheckAll();
    updateBulkBar();
});

document.getElementById('students-rows').addEventListener('click', async (e) => {
    const approveBtn = e.target.closest('button[data-approve]');
    if (approveBtn) {
        approveBtn.disabled = true;
        const { error } = await sb.from('profiles')
            .update({ approved: approveBtn.dataset.value === '1' })
            .eq('id', approveBtn.dataset.approve);
        if (error) alert(`Не получилось: ${error.message}`);
        await loadStudents();
        return;
    }

    const resetBtn = e.target.closest('button[data-reset]');
    if (resetBtn) return sendReset(resetBtn.dataset.reset, resetBtn);

    const deleteBtn = e.target.closest('button[data-delete]');
    if (deleteBtn) return deleteUsers([deleteBtn.dataset.delete], deleteBtn.dataset.name);

    const demoteBtn = e.target.closest('button[data-demote]');
    if (demoteBtn) return demoteAdmin(demoteBtn.dataset.demote, demoteBtn.dataset.name);
});

/** Возвращает администратора в обычные ученики. Себя разжаловать нельзя. */
async function demoteAdmin(id, name) {
    if (id === myId) return;
    if (!confirm(`Снять права администратора у «${name ?? ''}»? Он останется учеником с доступом к материалам, но потеряет доступ к панели управления.`)) return;

    const { error } = await sb.from('profiles').update({ role: 'student' }).eq('id', id);
    if (error) {
        alert(`Не получилось: ${error.message}`);
        return;
    }
    await loadStudents();
}

/* --------------------------------------------------------- Действия над группой */

document.getElementById('bulk-bar').addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-bulk]');
    if (!button) return;

    const ids = [...selected];
    if (!ids.length) return;
    const emails = students.filter(s => ids.includes(s.id)).map(s => s.email).filter(Boolean);

    switch (button.dataset.bulk) {
        case 'approve': return setApproval(ids, true);
        case 'revoke': return setApproval(ids, false);
        case 'reset': return sendResetMany(emails);
        case 'delete': return deleteUsers(ids);
    }
});

async function setApproval(ids, approved) {
    const { error } = await sb.from('profiles').update({ approved }).in('id', ids);
    if (error) alert(`Не получилось: ${error.message}`);
    await loadStudents();
}

/** Отправляет ученику письмо со ссылкой для сброса пароля. */
async function sendReset(email, button) {
    if (!email) return;
    if (!confirm(`Отправить ученику ${email} письмо со ссылкой для сброса пароля?`)) return;

    if (button) { button.disabled = true; button.textContent = 'Отправляем...'; }
    const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: new URL('reset-password.html', location.href).href,
    });

    if (error) {
        alert(`Не получилось отправить письмо: ${error.message}`);
        if (button) { button.textContent = 'Сбросить пароль'; button.disabled = false; }
    } else if (button) {
        button.textContent = 'Письмо отправлено';
        setTimeout(() => { button.textContent = 'Сбросить пароль'; button.disabled = false; }, 4000);
    }
}

async function sendResetMany(emails) {
    if (!emails.length) return;
    if (!confirm(`Отправить ссылку для сброса пароля выбранным ученикам (${emails.length})?`)) return;

    let ok = 0;
    let failed = 0;
    for (const email of emails) {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
            redirectTo: new URL('reset-password.html', location.href).href,
        });
        error ? failed++ : ok++;
    }
    alert(failed
        ? `Отправлено писем: ${ok}. Не удалось: ${failed}.\nВстроенная почта Supabase шлёт не больше 2 писем в час — остальным отправьте позже или подключите свой почтовый сервис.`
        : `Отправлено писем: ${ok}.`);
}

async function deleteUsers(ids, singleName) {
    const question = ids.length === 1
        ? `Удалить учётную запись «${singleName ?? ''}» безвозвратно? Ученик больше не сможет войти.`
        : `Удалить безвозвратно выбранные учётные записи (${ids.length})? Действие необратимо.`;
    if (!confirm(question)) return;

    const { data, error } = await sb.rpc('admin_delete_users', { targets: ids });
    if (error) {
        alert(`Не получилось удалить: ${error.message}`);
        return;
    }

    selected.clear();
    await loadStudents();
    if (typeof data === 'number' && data < ids.length) {
        alert(`Удалено: ${data} из ${ids.length}. Администраторов удалить нельзя.`);
    }
}

/* --------------------------------------------------------- Двухфакторный вход */

const mfaStatus = document.getElementById('mfa-status');
const mfaSetup = document.getElementById('mfa-setup');
const mfaEnableBtn = document.getElementById('mfa-enable');
const mfaDisableBtn = document.getElementById('mfa-disable');
const mfaMsg = document.getElementById('mfa-admin-message');
let enrollingFactorId = null;

async function loadMfa() {
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) {
        mfaStatus.textContent = 'Не удалось проверить состояние.';
        return;
    }

    const active = (data.totp ?? []).find(f => f.status === 'verified');

    mfaStatus.innerHTML = active
        ? '<span class="status-dot status-ok">Включён — при входе запрашивается код</span>'
        : '<span class="status-dot status-off">Выключен — вход только по паролю</span>';

    mfaEnableBtn.hidden = Boolean(active);
    mfaDisableBtn.hidden = !active;
    mfaSetup.hidden = true;
}

mfaEnableBtn?.addEventListener('click', async () => {
    hideMsg(mfaMsg);
    mfaEnableBtn.disabled = true;

    try {
        // Незавершённые попытки накапливаются — убираем их перед новой.
        const { data: existing } = await sb.auth.mfa.listFactors();
        for (const factor of existing?.all ?? []) {
            if (factor.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: factor.id });
        }

        const { data, error } = await sb.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: `ITSchool ${new Date().toLocaleDateString('ru-RU')}`,
        });
        if (error) throw error;

        enrollingFactorId = data.id;
        document.getElementById('mfa-qr').innerHTML = `<img src="${escapeHtml(data.totp.qr_code)}" alt="QR-код" width="200" height="200">`;
        document.getElementById('mfa-secret').textContent = data.totp.secret;
        mfaSetup.hidden = false;
        mfaEnableBtn.hidden = true;
    } catch (error) {
        showMsg(mfaMsg, `Не получилось начать подключение: ${error.message ?? error}`, 'err');
    } finally {
        mfaEnableBtn.disabled = false;
    }
});

document.getElementById('mfa-verify-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = e.target.elements.code.value.trim();

    if (!/^\d{6}$/.test(code)) {
        showMsg(mfaMsg, 'Код состоит из шести цифр.', 'err');
        return;
    }

    showMsg(mfaMsg, 'Проверяем код...', 'info');
    try {
        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: enrollingFactorId, code });
        if (error) throw error;

        showMsg(mfaMsg, 'Двухфакторный вход включён. В следующий раз спросим код.', 'ok');
        e.target.reset();
        await loadMfa();
    } catch (error) {
        showMsg(mfaMsg, /invalid|expired/i.test(String(error?.message))
            ? 'Код не подошёл. Введите текущий код из приложения — он меняется каждые 30 секунд.'
            : (error.message ?? 'Не удалось подтвердить код.'), 'err');
    }
});

document.getElementById('mfa-abort')?.addEventListener('click', async () => {
    if (enrollingFactorId) await sb.auth.mfa.unenroll({ factorId: enrollingFactorId });
    enrollingFactorId = null;
    hideMsg(mfaMsg);
    await loadMfa();
});

mfaDisableBtn?.addEventListener('click', async () => {
    if (!confirm('Отключить двухфакторный вход? Панель снова будет защищена только паролем.')) return;

    const { data } = await sb.auth.mfa.listFactors();
    for (const factor of data?.all ?? []) {
        await sb.auth.mfa.unenroll({ factorId: factor.id });
    }
    showMsg(mfaMsg, 'Двухфакторный вход отключён.', 'info');
    await loadMfa();
});

/* --------------------------------------------------------- Главная страница */

const siteForm = document.getElementById('site-form');
const siteMessage = document.getElementById('site-message');

async function loadSiteContent() {
    const { data } = await sb.from('site_content').select('content').eq('id', 1).maybeSingle();
    fillSiteForm(mergeContent(data?.content));
}

function fillSiteForm(c) {
    const setField = (name, value) => {
        const el = siteForm.elements[name];
        if (el) el.value = value ?? '';
    };

    setField('hero.eyebrow', c.hero.eyebrow);
    setField('hero.title', c.hero.title);
    setField('hero.lead', c.hero.lead);
    setField('hero.badges', c.hero.badges.join('\n'));

    setField('about.heading', c.about.heading);
    setField('about.p1', c.about.p1);
    setField('about.p2', c.about.p2);

    setField('contacts.telegram', c.contacts.telegram);
    setField('contacts.vk', c.contacts.vk);
    setField('contacts.max', c.contacts.max);

    // Повторяющиеся блоки строим заново, затем заполняем
    document.getElementById('site-stats').innerHTML = c.stats.map((s, i) => `
        <div class="form-row">
            <label class="field"><span>Цифра ${i + 1}</span>
                <input type="text" name="stats.${i}.num" value="${escapeHtml(s.num)}"></label>
            <label class="field"><span>Подпись ${i + 1}</span>
                <input type="text" name="stats.${i}.label" value="${escapeHtml(s.label)}"></label>
        </div>`).join('');

    document.getElementById('site-services').innerHTML = c.services.map((s, i) => `
        <label class="field"><span>Направление ${i + 1} — название</span>
            <input type="text" name="services.${i}.title" value="${escapeHtml(s.title)}"></label>
        <label class="field"><span>Направление ${i + 1} — описание</span>
            <textarea name="services.${i}.desc" rows="2">${escapeHtml(s.desc)}</textarea></label>`).join('');

    document.getElementById('site-prices').innerHTML = c.prices.map((p, i) => `
        <div class="form-row">
            <label class="field"><span>Тариф ${i + 1} — название</span>
                <input type="text" name="prices.${i}.name" value="${escapeHtml(p.name)}"></label>
            <label class="field"><span>Цена</span>
                <input type="text" name="prices.${i}.value" value="${escapeHtml(p.value)}"></label>
            <label class="field"><span>Единица</span>
                <input type="text" name="prices.${i}.unit" value="${escapeHtml(p.unit)}"></label>
        </div>
        <label class="field"><span>Что входит (по одному пункту в строке)</span>
            <textarea name="prices.${i}.features" rows="3">${escapeHtml(p.features)}</textarea></label>`).join('');
}

/** Собирает вложенный объект из полей формы. */
function collectSiteForm() {
    const out = {};
    siteForm.querySelectorAll('[name]').forEach(el => {
        const name = el.getAttribute('name');
        if (!/^(hero|stats|about|services|prices|contacts)\./.test(name)) return;

        const value = name === 'hero.badges'
            ? el.value.split('\n').map(s => s.trim()).filter(Boolean)
            : el.value.trim();

        const parts = name.split('.');
        let cur = out;
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i];
            if (cur[key] === undefined) cur[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
            cur = cur[key];
        }
        cur[parts[parts.length - 1]] = value;
    });
    return out;
}

/* Три ступени подтверждения */
const step1Btn = document.getElementById('site-step1');
const step2Box = document.getElementById('site-step2');
const step3Box = document.getElementById('site-step3');
const confirmCheck = document.getElementById('site-confirm-check');
const confirmWord = document.getElementById('site-confirm-word');
const applyBtn = document.getElementById('site-apply');

function resetSiteSteps() {
    step2Box.hidden = true;
    step3Box.hidden = true;
    confirmCheck.checked = false;
    confirmWord.value = '';
    applyBtn.disabled = true;
    step1Btn.disabled = false;
}

step1Btn?.addEventListener('click', () => {
    step2Box.hidden = false;
    step1Btn.disabled = true;
    hideMsg(siteMessage);
    confirmCheck.focus();
});

confirmCheck?.addEventListener('change', () => {
    step3Box.hidden = !confirmCheck.checked;
    if (confirmCheck.checked) confirmWord.focus();
    else { confirmWord.value = ''; applyBtn.disabled = true; }
});

confirmWord?.addEventListener('input', () => {
    applyBtn.disabled = confirmWord.value.trim() !== 'ГЛАВНАЯ';
});

applyBtn?.addEventListener('click', async () => {
    if (confirmWord.value.trim() !== 'ГЛАВНАЯ') return;

    applyBtn.disabled = true;
    showMsg(siteMessage, 'Сохраняем изменения главной...', 'info');

    const { error } = await sb.from('site_content')
        .update({ content: collectSiteForm(), updated_at: new Date().toISOString() })
        .eq('id', 1);

    if (error) {
        showMsg(siteMessage, `Не получилось сохранить: ${error.message}`, 'err');
        applyBtn.disabled = false;
        return;
    }

    showMsg(siteMessage, 'Готово. Главная страница обновлена — откройте её, чтобы проверить.', 'ok');
    resetSiteSteps();
});

document.getElementById('site-reset')?.addEventListener('click', () => {
    if (!confirm('Подставить в форму тексты по умолчанию? Это ещё не применит их — нужно пройти три шага подтверждения.')) return;
    fillSiteForm(mergeContent({}));
    resetSiteSteps();
    showMsg(siteMessage, 'В форму подставлены тексты по умолчанию. Чтобы применить — пройдите три шага.', 'info');
});

/* --------------------------------------------------------- Утилиты */

function parseTags(value) {
    return [...new Set(
        value.split(',').map(tag => tag.trim()).filter(Boolean)
    )];
}

function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

function parseLinks(value) {
    return value.split('\n')
        .map(line => {
            const [title, url] = line.split('|').map(part => part?.trim());
            if (!url) return null;
            return { title: title || url, url };
        })
        .filter(Boolean);
}

function extension(name) {
    return name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
}

/** Имя файла для хранилища: латиница, цифры, дефис. Исходное имя храним отдельно. */
function safeName(name) {
    const cleaned = name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    if (cleaned) return cleaned;
    // Имя из одной кириллицы схлопывается в пустую строку — расширение важно сохранить,
    // по нему подбирается иконка и браузер понимает, чем открывать скачанный файл.
    const ext = extension(name);
    return ext ? `materials.${ext}` : 'materials';
}

function uid() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
