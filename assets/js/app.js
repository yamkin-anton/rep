/* ==========================================================================
   Общий модуль: клиент Supabase, состояние авторизации, шапка, утилиты.
   Подключается на всех страницах.
   ========================================================================== */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, CONTACT_TELEGRAM } from './config.js?v=3';

/* --------------------------------------------------------- Клиент */

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const sb = isConfigured
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export { CONTACT_TELEGRAM };

/* --------------------------------------------------------- Авторизация */

let statePromise = null;

/**
 * Текущий пользователь и его профиль.
 * @returns {Promise<{user: object|null, profile: object|null, isAdmin: boolean, hasAccess: boolean}>}
 */
export function authState({ refresh = false } = {}) {
    if (refresh) statePromise = null;
    if (statePromise) return statePromise;

    statePromise = (async () => {
        const empty = { user: null, profile: null, isAdmin: false, hasAccess: false };
        if (!sb) return empty;

        const { data: { session } } = await sb.auth.getSession();
        if (!session) return empty;

        const { data: profile } = await sb
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

        const isAdmin = profile?.role === 'admin';
        return {
            user: session.user,
            profile,
            isAdmin,
            hasAccess: isAdmin || Boolean(profile?.approved),
        };
    })();

    return statePromise;
}

export async function signOut() {
    if (sb) await sb.auth.signOut();
    statePromise = null;
    location.href = 'index.html';
}

/**
 * Пускает на страницу только вошедших (и, если нужно, только админа).
 * Гостя отправляет на вход; вошедшему без прав возвращает null,
 * чтобы страница сама показала объяснение и не возникло петли редиректов.
 */
export async function requireAuth({ admin = false } = {}) {
    const state = await authState();

    if (!state.user) {
        const back = encodeURIComponent(location.pathname.split('/').pop() + location.search);
        location.replace(`login.html?next=${back}`);
        return null;
    }

    if (admin && !state.isAdmin) return null;

    return state;
}

/* --------------------------------------------------------- Шапка и общий UI */

async function renderNavAuth() {
    const box = document.getElementById('nav-auth');
    if (!box) return;

    const { user, profile, isAdmin } = await authState();

    if (!user) {
        box.innerHTML = `<a class="btn btn-light btn-sm" href="login.html">Войти</a>`;
        return;
    }

    const name = escapeHtml(profile?.full_name || user.email || 'Профиль');
    box.innerHTML = `
        ${isAdmin ? '<a class="btn btn-light btn-sm" href="admin.html">Админка</a>' : ''}
        <span class="nav-user" title="${name}">${name}</span>
        <button class="btn btn-light btn-sm" type="button" id="nav-signout">Выйти</button>`;

    document.getElementById('nav-signout').addEventListener('click', signOut);
}

function initNavToggle() {
    const toggle = document.querySelector('.nav-toggle');
    const menu = document.querySelector('.nav-menu');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', () => {
        const open = menu.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
    });
}

function markActiveLink() {
    const page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a').forEach(a => {
        if (a.getAttribute('href') === page) a.classList.add('active');
    });
}

function initToTop() {
    const btn = document.querySelector('.to-top');
    if (!btn) return;

    addEventListener('scroll', () => {
        btn.classList.toggle('show', scrollY > 400);
    }, { passive: true });

    btn.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
}

/** Плавное появление блоков с классом .reveal при прокрутке. */
export function initReveal(root = document) {
    const items = root.querySelectorAll('.reveal:not(.visible)');
    if (!items.length) return;

    const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('visible');
            io.unobserve(entry.target);
        });
    }, { threshold: .12 });

    items.forEach(el => io.observe(el));
}

function initCommonUI() {
    initNavToggle();
    markActiveLink();
    initToTop();
    initReveal();
    renderNavAuth();

    const year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCommonUI);
} else {
    initCommonUI();
}

/* --------------------------------------------------------- Видео */

/**
 * Определяет площадку по ссылке и возвращает готовую разметку плеера.
 * Поддержаны YouTube, VK Видео, Rutube, Dzen и прямые файлы (mp4/webm/ogg).
 * @param {string} url
 * @returns {string} HTML плеера или пустая строка
 */
export function videoEmbed(url) {
    const src = embedSrc(url);
    if (!src) return '';

    if (src.type === 'file') {
        return `<div class="player"><video src="${escapeAttr(src.url)}" controls playsinline preload="metadata"></video></div>`;
    }
    return `<div class="player"><iframe src="${escapeAttr(src.url)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen title="Видеоурок"></iframe></div>`;
}

export function embedSrc(raw) {
    if (!raw) return null;
    const url = String(raw).trim();

    if (/^https?:\/\/\S+\.(mp4|webm|ogv|ogg|mov)(\?\S*)?$/i.test(url)) {
        return { type: 'file', url };
    }

    let u;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    const host = u.hostname.replace(/^www\./, '');

    // YouTube
    if (host === 'youtu.be') {
        const id = u.pathname.slice(1);
        if (id) return { type: 'iframe', url: `https://www.youtube.com/embed/${id}` };
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
        const id = u.searchParams.get('v')
            || u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]+)/)?.[1];
        if (id) {
            const t = u.searchParams.get('t') || u.searchParams.get('start');
            const start = t ? `?start=${parseInt(t, 10) || 0}` : '';
            return { type: 'iframe', url: `https://www.youtube.com/embed/${id}${start}` };
        }
    }

    // VK Видео — уже готовая ссылка на встраивание
    if (u.pathname.includes('video_ext.php')) {
        return { type: 'iframe', url };
    }
    if (host.endsWith('vk.com') || host.endsWith('vkvideo.ru') || host.endsWith('vk.ru')) {
        const m = u.pathname.match(/video(-?\d+)_(\d+)/) || u.search.match(/video(-?\d+)_(\d+)/);
        if (m) {
            return { type: 'iframe', url: `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2` };
        }
    }

    // Rutube
    if (host.endsWith('rutube.ru')) {
        const id = u.pathname.match(/\/(?:video|play\/embed)\/([\w]+)/)?.[1];
        if (id) return { type: 'iframe', url: `https://rutube.ru/play/embed/${id}` };
    }

    // Дзен
    if (host.endsWith('dzen.ru') && u.pathname.includes('/video/watch/')) {
        const id = u.pathname.split('/').pop();
        if (id) return { type: 'iframe', url: `https://dzen.ru/embed/${id}` };
    }

    return { type: 'iframe', url };
}

/* --------------------------------------------------------- Утилиты */

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export const escapeAttr = escapeHtml;

/**
 * Проверяет пароль по тем же правилам, что заданы в настройках Supabase:
 * не короче 10 символов, латинские строчная и заглавная буквы и цифра.
 * @returns {string|null} текст ошибки или null, если всё в порядке
 */
export function passwordProblem(value) {
    if (!value || value.length < 10) return 'Пароль должен быть не короче 10 символов.';
    if (!/[a-z]/.test(value)) return 'Добавьте строчную латинскую букву.';
    if (!/[A-Z]/.test(value)) return 'Добавьте заглавную латинскую букву.';
    if (!/[0-9]/.test(value)) return 'Добавьте хотя бы одну цифру.';
    return null;
}

export function formatBytes(bytes) {
    if (!bytes) return '';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    let n = Number(bytes);
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric',
    });
}

export function formatDuration(minutes) {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h} ч ${m ? m + ' мин' : ''}`.trim() : `${m} мин`;
}

export const LEVELS = {
    basic: 'Базовый',
    medium: 'Средний',
    advanced: 'Продвинутый',
};

/** Показать сообщение в блоке .form-msg */
export function showMsg(el, text, kind = 'info') {
    if (!el) return;
    el.className = `form-msg show ${kind}`;
    el.textContent = text;
}

export function hideMsg(el) {
    if (el) el.className = 'form-msg';
}

/** Предупреждение, если Supabase ещё не настроен. */
export function configWarning() {
    return `<div class="banner">
        <strong>Раздел материалов ещё не подключён.</strong>
        Откройте <code>assets/js/config.js</code> и впишите адрес проекта Supabase
        и ключ <code>anon</code>. Пошаговая инструкция — в файле <code>README.md</code>.
    </div>`;
}

/* Набор иконок, чтобы не дублировать SVG по страницам */
export const icons = {
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    signal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 18v-4M12 18V9M19 18V5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M8 15h4"/></svg>',
    tree: '<svg viewBox="0 0 120 140" fill="none"><g stroke="currentColor" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M60 136V58"/><path d="M60 136 44 140"/><path d="M60 136 78 138"/><path d="M60 114 37.7 98.07"/><path d="M60 96 84.36 78.14"/><path d="M60 74 41.16 56.73"/><path d="M60 58 52.69 40.46"/><path d="M60 58 74.53 46.37"/></g><g stroke="currentColor" stroke-width="4" fill="none"><circle cx="32" cy="94" r="7"/><circle cx="90" cy="74" r="7"/><circle cx="36" cy="52" r="7"/><circle cx="50" cy="34" r="7"/><circle cx="80" cy="42" r="7"/></g></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
};
