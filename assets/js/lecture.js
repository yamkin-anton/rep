/* ==========================================================================
   Страница одного урока: плеер, описание, файлы.

   Витрину (название, обложку, описание) отдаёт представление lectures_catalog
   и её видят все. Ссылку на видео и файлы отдаёт таблица lectures — она
   закрыта политиками RLS, поэтому «замок» нельзя обойти через консоль.
   ========================================================================== */

import {
    sb, isConfigured, authState, configWarning, videoEmbed,
    escapeHtml, formatBytes, formatDate, formatDuration,
    icons, LEVELS, CONTACT_TELEGRAM,
} from './app.js?v=3';
import { BUCKET_MATERIALS } from './config.js?v=3';

const box = document.getElementById('lesson');
const id = new URLSearchParams(location.search).get('id');

async function load() {
    if (!isConfigured) {
        box.innerHTML = configWarning();
        return;
    }
    if (!id) {
        notFound();
        return;
    }

    // 1. Витрина — доступна всем
    const { data: preview } = await sb
        .from('lectures_catalog')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    // 2. Полная карточка — только если у пользователя есть доступ
    const { data: full } = await sb
        .from('lectures')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    const item = full ?? preview;
    if (!item) {
        notFound();
        return;
    }

    document.title = `${item.title} — ITSchool`;
    render(item, Boolean(full));

    if (full) sb.rpc('increment_views', { lecture_id: id });
}

function notFound() {
    box.innerHTML = `<div class="empty">${icons.empty}
        <h3>Материал не найден</h3>
        <p>Возможно, урок ещё не опубликован или ссылка устарела.</p>
        <a class="btn btn-outline" href="lectures.html">Ко всем материалам</a></div>`;
}

/* --------------------------------------------------------- Отрисовка */

function render(item, unlocked) {
    const meta = [
        item.duration_min ? `<span>${icons.clock}${formatDuration(item.duration_min)}</span>` : '',
        `<span>${icons.signal}${LEVELS[item.level] ?? LEVELS.basic}</span>`,
        `<span>${icons.calendar}${formatDate(item.created_at)}</span>`,
    ].join('');

    const tags = (item.tags ?? [])
        .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

    const player = unlocked
        ? (videoEmbed(item.video_url) || coverBlock(item))
        : lockedBlock();

    const description = escapeHtml(item.description ?? item.summary ?? '')
        .split(/\n{2,}/)
        .filter(Boolean)
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');

    box.innerHTML = `
        <header style="margin-bottom:1.6rem;">
            <div class="lecture-tags" style="margin-bottom:.8rem;">
                ${item.is_free ? '<span class="tag">Открытый урок</span>' : ''}${tags}
            </div>
            <h1 style="font-size:clamp(1.7rem,3.6vw,2.6rem);">${escapeHtml(item.title)}</h1>
            <div class="lecture-meta">${meta}</div>
        </header>

        <div class="lesson-layout">
            <div>
                ${player}
                <div class="card" style="margin-top:1.5rem;">
                    <h3>Описание урока</h3>
                    ${description || '<p class="muted">Описание не заполнено.</p>'}
                </div>
            </div>
            <aside id="sidebar"></aside>
        </div>`;

    renderSidebar(item, unlocked);
}

function coverBlock(item) {
    return item.cover_url
        ? `<img src="${escapeHtml(item.cover_url)}" alt="" style="border-radius:var(--radius);width:100%;">`
        : `<div class="locked">${icons.tree}<h3>Видео к уроку пока не добавлено</h3>
             <p>Материалы к занятию можно скачать в блоке справа.</p></div>`;
}

function lockedBlock() {
    return `<div class="locked">
        ${icons.lock}
        <h3>Урок доступен ученикам</h3>
        <p>Откройте доступ — и видео вместе с файлами появится здесь.
           Напишите мне, если вы занимаетесь со мной, но доступа пока нет.</p>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;margin-top:1.2rem;">
            <a class="btn" href="login.html?next=${encodeURIComponent('lecture.html?id=' + id)}">Войти</a>
            <a class="btn btn-light" href="${CONTACT_TELEGRAM}" target="_blank" rel="noopener">Написать в Telegram</a>
        </div>
    </div>`;
}

async function renderSidebar(item, unlocked) {
    const side = document.getElementById('sidebar');
    const blocks = [];

    if (unlocked && item.archive_path) {
        blocks.push(`<div class="card" style="margin-bottom:1.2rem;">
            <h3>Файлы к занятию</h3>
            <div id="files"><p class="muted">Готовим ссылку...</p></div>
        </div>`);
    }

    const links = Array.isArray(item.links) ? item.links : [];
    if (unlocked && links.length) {
        blocks.push(`<div class="card" style="margin-bottom:1.2rem;">
            <h3>Полезные ссылки</h3>
            ${links.map(link => `<a class="file-item" href="${escapeHtml(link.url)}" target="_blank" rel="noopener">
                <span class="file-icon">${icons.link}</span>
                <span class="file-name">${escapeHtml(link.title || link.url)}</span>
            </a>`).join('')}
        </div>`);
    }

    if (!unlocked) {
        const { user } = await authState();
        blocks.push(`<div class="card" style="margin-bottom:1.2rem;">
            <h3>Как получить доступ</h3>
            <p class="muted">${user
                ? 'Вы вошли на сайт, но доступ к закрытым материалам ещё не открыт. Напишите мне — открою в течение дня.'
                : 'Зарегистрируйтесь на сайте и напишите мне в Telegram: я открою доступ ко всем урокам курса.'}</p>
            <a class="btn btn-outline" href="${CONTACT_TELEGRAM}" target="_blank" rel="noopener">Написать в Telegram</a>
        </div>`);
    }

    blocks.push(`<div class="card">
        <h3>Об уроке</h3>
        <ul class="checklist" style="margin-top:0;">
            <li>Уровень: ${LEVELS[item.level] ?? LEVELS.basic}</li>
            ${item.duration_min ? `<li>Длительность: ${formatDuration(item.duration_min)}</li>` : ''}
            <li>Опубликовано: ${formatDate(item.created_at)}</li>
            <li>Доступ: ${item.is_free ? 'открытый урок' : 'для учеников'}</li>
        </ul>
    </div>`);

    side.innerHTML = blocks.join('');

    if (unlocked && item.archive_path) await renderArchive(item);
}

/** Ссылка на приватный файл живёт час и выдаётся только тем, кто прошёл RLS. */
async function renderArchive(item) {
    const target = document.getElementById('files');
    if (!target) return;

    const { data, error } = await sb.storage
        .from(BUCKET_MATERIALS)
        .createSignedUrl(item.archive_path, 3600, { download: item.archive_name || true });

    if (error || !data?.signedUrl) {
        target.innerHTML = '<p class="muted">Не удалось получить ссылку на файл. Обновите страницу или напишите мне.</p>';
        return;
    }

    target.innerHTML = `<a class="file-item" href="${escapeHtml(data.signedUrl)}">
        <span class="file-icon">${icons.archive}</span>
        <span>
            <span class="file-name">${escapeHtml(item.archive_name || 'Материалы урока')}</span>
            <span class="file-size">${formatBytes(item.archive_size) || 'архив'} · скачать</span>
        </span>
    </a>`;
}

load();
