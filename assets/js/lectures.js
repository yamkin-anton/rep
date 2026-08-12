/* ==========================================================================
   Каталог материалов: список, фильтр по тегам, поиск, сортировка.
   ========================================================================== */

import {
    sb, isConfigured, authState, configWarning,
    escapeHtml, formatDate, formatDuration, icons, LEVELS, CONTACT_TELEGRAM,
} from './app.js?v=1';

const grid = document.getElementById('lectures');
const tagBox = document.getElementById('tag-filters');
const searchInput = document.getElementById('search');
const sortSelect = document.getElementById('sort');
const countLabel = document.getElementById('count');
const notice = document.getElementById('notice');

let all = [];
let activeTag = '';

/* --------------------------------------------------------- Загрузка */

async function load() {
    if (!isConfigured) {
        notice.innerHTML = configWarning();
        all = demoLectures();
        render();
        return;
    }

    const { data, error } = await sb
        .from('lectures_catalog')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        grid.innerHTML = `<div class="empty">${icons.empty}
            <p>Не удалось загрузить материалы: ${escapeHtml(error.message)}</p></div>`;
        return;
    }

    all = data ?? [];
    await renderNotice();
    render();
}

/** Подсказка о том, как получить доступ к закрытым урокам. */
async function renderNotice() {
    const hasLocked = all.some(item => !item.is_free);
    if (!hasLocked) return;

    const { user, hasAccess } = await authState();
    if (hasAccess) return;

    notice.innerHTML = user
        ? `<div class="banner">Ваша учётная запись создана, но доступ к закрытым материалам ещё не открыт.
             Напишите мне в <a href="${CONTACT_TELEGRAM}" target="_blank" rel="noopener">Telegram</a> —
             открою доступ, и уроки появятся здесь.</div>`
        : `<div class="banner">Часть уроков открыта для всех. Чтобы получить остальные,
             <a href="login.html">войдите на сайт</a> — доступ открывается ученикам.</div>`;
}

/* --------------------------------------------------------- Отрисовка */

function visibleLectures() {
    const query = searchInput.value.trim().toLowerCase();

    let list = all.filter(item => {
        if (activeTag && !(item.tags ?? []).includes(activeTag)) return false;
        if (!query) return true;
        return `${item.title} ${item.summary ?? ''}`.toLowerCase().includes(query);
    });

    const sorters = {
        new: (a, b) => new Date(b.created_at) - new Date(a.created_at),
        old: (a, b) => new Date(a.created_at) - new Date(b.created_at),
        title: (a, b) => a.title.localeCompare(b.title, 'ru'),
        popular: (a, b) => (b.views ?? 0) - (a.views ?? 0),
    };
    return list.sort(sorters[sortSelect.value] ?? sorters.new);
}

function renderTags() {
    const tags = [...new Set(all.flatMap(item => item.tags ?? []))].sort((a, b) => a.localeCompare(b, 'ru'));
    if (!tags.length) {
        tagBox.innerHTML = '';
        return;
    }

    tagBox.innerHTML = [
        `<button class="chip${activeTag ? '' : ' active'}" data-tag="">Все</button>`,
        ...tags.map(tag =>
            `<button class="chip${tag === activeTag ? ' active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`),
    ].join('');
}

function card(item) {
    const cover = item.cover_url
        ? `<img src="${escapeHtml(item.cover_url)}" alt="" loading="lazy">`
        : `<div class="lecture-cover-fallback">${icons.tree}</div>`;

    const meta = [
        item.duration_min ? `<span>${icons.clock}${formatDuration(item.duration_min)}</span>` : '',
        `<span>${icons.signal}${LEVELS[item.level] ?? LEVELS.basic}</span>`,
        `<span>${icons.calendar}${formatDate(item.created_at)}</span>`,
    ].join('');

    const tags = (item.tags ?? [])
        .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

    const access = item.is_free
        ? '<span class="badge badge-free">Открыто</span>'
        : `<span class="badge badge-lock">${icons.lock}Для учеников</span>`;

    return `<a class="lecture-card" href="lecture.html?id=${encodeURIComponent(item.id)}">
        <div class="lecture-cover">
            ${cover}
            <div class="lecture-badges">${access}
                ${item.has_files ? '<span class="badge">Есть файлы</span>' : ''}</div>
        </div>
        <div class="lecture-body">
            <h3>${escapeHtml(item.title)}</h3>
            <div class="lecture-meta">${meta}</div>
            <p>${escapeHtml(item.summary ?? '')}</p>
            <div class="lecture-tags">${tags}</div>
        </div>
    </a>`;
}

function render() {
    renderTags();
    const list = visibleLectures();

    countLabel.textContent = list.length
        ? `${list.length} ${plural(list.length, 'материал', 'материала', 'материалов')}`
        : '';

    if (list.length) {
        grid.innerHTML = list.map(card).join('');
        return;
    }

    // Пустой каталог и пустая выдача по фильтру — разные ситуации.
    grid.innerHTML = all.length
        ? `<div class="empty" style="grid-column:1/-1;">${icons.empty}
             <h3>Ничего не нашлось</h3>
             <p>Попробуйте изменить запрос или выбрать другой тег.</p></div>`
        : `<div class="empty" style="grid-column:1/-1;">${icons.empty}
             <h3>Здесь пока пусто</h3>
             <p>Первые видеоуроки и материалы к занятиям появятся совсем скоро.</p></div>`;
}

function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

/* --------------------------------------------------------- События */

tagBox.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    activeTag = chip.dataset.tag;
    render();
});

let searchTimer;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 180);
});

sortSelect.addEventListener('change', render);

/* --------------------------------------------------------- Демо-данные */

/** Показываются, пока не заполнен config.js — чтобы страница не выглядела сломанной. */
function demoLectures() {
    const day = 86400000;
    return [
        {
            id: 'demo-1', title: 'Задание 1 ОГЭ: количество информации',
            summary: 'Разбираем формулу измерения информации и типовые ловушки в условии задачи.',
            tags: ['ОГЭ', 'Теория'], level: 'basic', duration_min: 24, is_free: true,
            views: 0, created_at: new Date(Date.now() - day).toISOString(), has_files: true, cover_url: null,
        },
        {
            id: 'demo-2', title: 'Задание 24 ЕГЭ: обработка символьной строки',
            summary: 'Полное решение на Python, разбор частых ошибок и оформление ответа.',
            tags: ['ЕГЭ', 'Python'], level: 'advanced', duration_min: 42, is_free: false,
            views: 0, created_at: new Date(Date.now() - day * 4).toISOString(), has_files: true, cover_url: null,
        },
        {
            id: 'demo-3', title: 'Списки и циклы в Python',
            summary: 'Базовое занятие курса программирования: перебор, срезы, вложенные циклы.',
            tags: ['Python', 'Основы'], level: 'medium', duration_min: 55, is_free: false,
            views: 0, created_at: new Date(Date.now() - day * 9).toISOString(), has_files: false, cover_url: null,
        },
    ];
}

load();
