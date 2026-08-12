/* ==========================================================================
   Панель управления: добавление уроков и доступ учеников.
   Все операции защищены политиками RLS — страница лишь удобный интерфейс.
   ========================================================================== */

import {
    sb, isConfigured, requireAuth, configWarning,
    escapeHtml, formatBytes, formatDate, showMsg, hideMsg, LEVELS,
} from './app.js';
import { BUCKET_COVERS, BUCKET_MATERIALS } from './config.js';

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

    await Promise.all([loadLectures(), loadStudents(), loadMfa()]);
})();

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
        : 'До 50 МБ на бесплатном тарифе Supabase.';

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
    archiveHint.textContent = 'До 50 МБ на бесплатном тарифе Supabase.';
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
            showMsg(message, 'Загружаем архив с материалами...', 'info');
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
    if (error) throw new Error(`архив — ${error.message}`);

    return { archive_path: path, archive_name: file.name, archive_size: file.size };
}

/* --------------------------------------------------------- Ученики */

async function loadStudents() {
    const { data, error } = await sb
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

    const rows = document.getElementById('students-rows');
    if (error) {
        rows.innerHTML = `<tr><td colspan="5">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
        return;
    }

    const students = data ?? [];
    const waiting = students.filter(s => s.role !== 'admin' && !s.approved).length;
    document.getElementById('tab-students').textContent = waiting ? `(${waiting} ждут)` : `(${students.length})`;

    if (!students.length) {
        rows.innerHTML = '<tr><td colspan="5" class="muted">Пока никто не зарегистрировался.</td></tr>';
        return;
    }

    rows.innerHTML = students.map(person => `
        <tr>
            <td><strong>${escapeHtml(person.full_name || 'Без имени')}</strong>
                ${person.role === 'admin' ? '<br><span class="tag">администратор</span>' : ''}</td>
            <td>${escapeHtml(person.email ?? '')}</td>
            <td>${formatDate(person.created_at)}</td>
            <td><span class="status-dot ${person.approved ? 'status-ok' : 'status-off'}">
                ${person.approved ? 'Открыт' : 'Закрыт'}</span></td>
            <td>${person.role === 'admin' ? '' : `
                <button class="btn btn-sm ${person.approved ? 'btn-danger' : 'btn-outline'}"
                    data-approve="${person.id}" data-value="${person.approved ? '0' : '1'}">
                    ${person.approved ? 'Закрыть доступ' : 'Открыть доступ'}
                </button>`}</td>
        </tr>`).join('');
}

document.getElementById('students-rows').addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-approve]');
    if (!button) return;

    button.disabled = true;
    const { error } = await sb.from('profiles')
        .update({ approved: button.dataset.value === '1' })
        .eq('id', button.dataset.approve);

    if (error) alert(`Не получилось: ${error.message}`);
    await loadStudents();
});

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

/* --------------------------------------------------------- Утилиты */

function parseTags(value) {
    return [...new Set(
        value.split(',').map(tag => tag.trim()).filter(Boolean)
    )];
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
    return cleaned || 'materials.zip';
}

function uid() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
