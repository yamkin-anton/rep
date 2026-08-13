/* ==========================================================================
   Вход и регистрация ученика.
   ========================================================================== */

import { sb, isConfigured, authState, configWarning, showMsg, hideMsg, passwordProblem } from './app.js?v=4';

const form = document.getElementById('auth-form');
const message = document.getElementById('auth-message');
const submit = document.getElementById('submit-btn');
const nameField = document.getElementById('name-field');
const confirmField = document.getElementById('confirm-field');
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
        confirmField.hidden = !signup;
        form.elements.full_name.required = signup;
        form.elements.confirm.required = signup;
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

    if (!email) {
        showMsg(message, 'Укажите электронную почту.', 'err');
        return;
    }

    // При регистрации проверяем требования к паролю сразу, не гоняя на сервер.
    const weak = mode === 'signup' ? passwordProblem(pass) : (pass ? null : 'Введите пароль.');
    if (weak) {
        showMsg(message, weak, 'err');
        return;
    }
    if (mode === 'signup' && pass !== form.elements.confirm.value) {
        showMsg(message, 'Пароли не совпадают — введите одинаковый пароль в обоих полях.', 'err');
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

        // Если у пользователя включён двухфакторный вход, сессия сейчас
        // имеет уровень aal1 и нужен код из приложения.
        if (await needsSecondFactor()) {
            showMfaStep();
            return;
        }

        await finishLogin();
    } catch (error) {
        showMsg(message, translate(error), 'err');
        submit.disabled = false;
    }
});

async function finishLogin() {
    const state = await authState({ refresh: true });
    location.href = nextPage(state.isAdmin);
}

/* Сброс пароля запускает только администратор из панели управления —
   ученику ссылку присылают вручную. Здесь самостоятельного сброса нет. */

/* --------------------------------------------------------- Второй фактор */

const mfaForm = document.getElementById('mfa-form');
const mfaMessage = document.getElementById('mfa-message');
const mfaBtn = document.getElementById('mfa-btn');

async function needsSecondFactor() {
    const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return false;
    return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}

function showMfaStep() {
    form.hidden = true;
    document.querySelector('.tabs').hidden = true;
    document.getElementById('form-title').hidden = true;
    document.getElementById('form-lead').hidden = true;
    mfaForm.hidden = false;
    mfaForm.elements.code.focus();
}

mfaForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const code = mfaForm.elements.code.value.trim();
    if (!/^\d{6}$/.test(code)) {
        showMsg(mfaMessage, 'Код состоит из шести цифр.', 'err');
        return;
    }

    mfaBtn.disabled = true;
    showMsg(mfaMessage, 'Проверяем код...', 'info');

    try {
        const { data: factors, error: listError } = await sb.auth.mfa.listFactors();
        if (listError) throw listError;

        const totp = factors.totp?.[0];
        if (!totp) throw new Error('Не найдено приложение-аутентификатор.');

        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
        if (error) throw error;

        await finishLogin();
    } catch (error) {
        showMsg(mfaMessage, /invalid|expired/i.test(String(error?.message))
            ? 'Код не подошёл. Проверьте, что вводите текущий код из приложения.'
            : (error.message ?? 'Не удалось подтвердить код.'), 'err');
        mfaBtn.disabled = false;
    }
});

document.getElementById('mfa-cancel')?.addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
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

/* Если пользователь уже вошёл — незачем показывать форму.
   Но недоведённый до конца двухфакторный вход нужно продолжить, а не пропустить. */
authState().then(async (state) => {
    if (!state.user) return;

    if (await needsSecondFactor()) {
        showMfaStep();
        return;
    }
    location.replace(nextPage(state.isAdmin));
});
