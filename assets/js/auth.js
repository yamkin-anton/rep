/* ==========================================================================
   Вход и регистрация ученика.
   ========================================================================== */

import { sb, isConfigured, authState, configWarning, showMsg, hideMsg } from './app.js';

const form = document.getElementById('auth-form');
const message = document.getElementById('auth-message');
const submit = document.getElementById('submit-btn');
const nameField = document.getElementById('name-field');
const title = document.getElementById('form-title');
const lead = document.getElementById('form-lead');
const password = form.elements.password;

let mode = 'signin';

/** Куда вернуть пользователя после входа. Только внутренние страницы. */
function nextPage(isAdmin = false) {
    const raw = new URLSearchParams(location.search).get('next') || '';
    const safe = /^[\w.-]+\.html(\?[\w=%&.-]*)?$/.test(raw) ? raw : '';

    // Ученика не отправляем в админку, иначе получится петля переходов.
    if (!safe || (!isAdmin && safe.startsWith('admin.html'))) {
        return isAdmin ? 'admin.html' : 'lectures.html';
    }
    return safe;
}

if (!isConfigured) {
    document.getElementById('config-warning').innerHTML = configWarning();
    form.querySelectorAll('input, button').forEach(el => (el.disabled = true));
}

/* --------------------------------------------------------- Переключение режима */

document.querySelectorAll('.tab[data-mode]').forEach(tab => {
    tab.addEventListener('click', () => {
        mode = tab.dataset.mode;

        document.querySelectorAll('.tab[data-mode]')
            .forEach(t => t.classList.toggle('active', t === tab));

        const signup = mode === 'signup';
        nameField.hidden = !signup;
        form.elements.full_name.required = signup;
        password.autocomplete = signup ? 'new-password' : 'current-password';
        title.textContent = signup ? 'Регистрация ученика' : 'Вход для учеников';
        lead.textContent = signup
            ? 'Создайте учётную запись — после этого я открою доступ к материалам курса.'
            : 'Войдите, чтобы открыть видеоуроки и файлы к занятиям.';
        submit.textContent = signup ? 'Зарегистрироваться' : 'Войти';
        hideMsg(message);
    });
});

/* --------------------------------------------------------- Отправка */

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb) return;

    const email = form.elements.email.value.trim();
    const pass = password.value;
    const fullName = form.elements.full_name.value.trim();

    if (!email || pass.length < 6) {
        showMsg(message, 'Проверьте почту и пароль: пароль должен быть не короче 6 символов.', 'err');
        return;
    }
    if (mode === 'signup' && !fullName) {
        showMsg(message, 'Укажите имя и фамилию — так я найду вас в списке учеников.', 'err');
        return;
    }

    submit.disabled = true;
    showMsg(message, mode === 'signup' ? 'Создаём учётную запись...' : 'Проверяем данные...', 'info');

    try {
        if (mode === 'signup') {
            const { data, error } = await sb.auth.signUp({
                email,
                password: pass,
                options: { data: { full_name: fullName } },
            });
            if (error) throw error;

            // Если в проекте включено подтверждение почты, сессии сразу не будет.
            if (!data.session) {
                showMsg(message, 'Почти готово: подтвердите адрес по ссылке из письма, затем войдите.', 'ok');
                submit.disabled = false;
                return;
            }
        } else {
            const { error } = await sb.auth.signInWithPassword({ email, password: pass });
            if (error) throw error;
        }

        const state = await authState({ refresh: true });
        location.href = nextPage(state.isAdmin);
    } catch (error) {
        showMsg(message, translate(error), 'err');
        submit.disabled = false;
    }
});

/** Понятные подписи вместо английских ответов Supabase. */
function translate(error) {
    const text = String(error?.message ?? '');
    if (/Invalid login credentials/i.test(text)) return 'Неверная почта или пароль.';
    if (/User already registered/i.test(text)) return 'Такая почта уже зарегистрирована — переключитесь на вкладку «Вход».';
    if (/Email not confirmed/i.test(text)) return 'Адрес почты ещё не подтверждён — проверьте письмо.';
    if (/Password should be/i.test(text)) return 'Пароль слишком короткий: нужно минимум 6 символов.';
    if (/rate limit|too many/i.test(text)) return 'Слишком много попыток. Подождите пару минут и попробуйте снова.';
    if (/signups not allowed|Signup is disabled/i.test(text)) return 'Регистрация сейчас закрыта. Напишите мне в Telegram.';
    return text || 'Что-то пошло не так. Попробуйте ещё раз.';
}

/* Если пользователь уже вошёл — незачем показывать форму */
authState().then(state => {
    if (state.user) location.replace(nextPage(state.isAdmin));
});
