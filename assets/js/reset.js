/* ==========================================================================
   Страница задания нового пароля.

   Открывается по ссылке из письма «сброс пароля». Supabase, обнаружив в
   адресе токен восстановления, создаёт временную сессию — только она и
   разрешает сменить пароль. Без действительной ссылки форма не появится.
   ========================================================================== */

import { sb, isConfigured, showMsg, passwordProblem } from './app.js?v=3';

const checking = document.getElementById('reset-checking');
const invalid = document.getElementById('reset-invalid');
const form = document.getElementById('reset-form');
const message = document.getElementById('reset-message');
const submit = document.getElementById('reset-btn');

let shown = false;

function showForm() {
    if (shown) return;
    shown = true;
    checking.hidden = true;
    invalid.hidden = true;
    form.hidden = false;
    form.elements.password.focus();
}

function showInvalid() {
    if (shown) return;
    checking.hidden = true;
    form.hidden = true;
    invalid.hidden = false;
}

if (!isConfigured) {
    showInvalid();
} else {
    // Токен восстановления обрабатывается асинхронно при загрузке страницы,
    // поэтому слушаем событие и дополнительно проверяем сессию с запасом по времени.
    sb.auth.onAuthStateChange((_event, session) => {
        if (session) showForm();
    });

    (async () => {
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
            showForm();
        } else {
            // Даём время на разбор токена из адреса, затем решаем окончательно.
            setTimeout(async () => {
                const { data } = await sb.auth.getSession();
                if (data.session) showForm();
                else showInvalid();
            }, 1500);
        }
    })();
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = form.elements.password.value;
    const confirm = form.elements.confirm.value;

    const weak = passwordProblem(password);
    if (weak) {
        showMsg(message, weak, 'err');
        return;
    }
    if (password !== confirm) {
        showMsg(message, 'Пароли не совпадают.', 'err');
        return;
    }

    submit.disabled = true;
    showMsg(message, 'Сохраняем новый пароль...', 'info');

    const { error } = await sb.auth.updateUser({ password });

    if (error) {
        showMsg(message, /New password should be different/i.test(error.message)
            ? 'Новый пароль должен отличаться от старого.'
            : (error.message ?? 'Не удалось сохранить пароль.'), 'err');
        submit.disabled = false;
        return;
    }

    showMsg(message, 'Пароль изменён. Сейчас откроется страница входа.', 'ok');
    await sb.auth.signOut();
    setTimeout(() => (location.href = 'login.html'), 1800);
});
