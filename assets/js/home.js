/* ==========================================================================
   Главная страница: выбор направления и отправка заявки.
   ========================================================================== */

import { showMsg, sb, isConfigured } from './app.js?v=2';
import { applyContent } from './content.js?v=2';

/* --------------------------------------------------------- Тексты главной */

/** Подставляет отредактированные в админке тексты. При любой ошибке
    остаётся вёрстка по умолчанию из index.html. */
(async function loadSiteContent() {
    if (!isConfigured) return;
    try {
        const { data } = await sb
            .from('site_content')
            .select('content')
            .eq('id', 1)
            .maybeSingle();
        if (data?.content && Object.keys(data.content).length) {
            applyContent(data.content);
        }
    } catch {
        /* молча оставляем тексты по умолчанию */
    }
})();

const messageField = document.getElementById('message-field');
const contactSection = document.getElementById('contact');

/** Подставляет выбранное направление в форму записи. */
function pickService(service) {
    if (messageField && service && !messageField.value.trim()) {
        messageField.value = `Хочу записаться на направление: ${service}. `;
    }
    contactSection?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => messageField?.focus({ preventScroll: true }), 500);
}

document.querySelectorAll('[data-service]').forEach(el => {
    el.addEventListener('click', () => pickService(el.dataset.service));

    // карточки услуг доступны и с клавиатуры
    if (el.matches('.service')) {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pickService(el.dataset.service);
            }
        });
    }
});

/* --------------------------------------------------------- Форма заявки */

const form = document.getElementById('contact-form');
const formMsg = document.getElementById('form-message');

/** Не больше одной заявки в сутки с одного устройства. */
function alreadySentToday() {
    const last = localStorage.getItem('lastFormSubmit');
    if (!last) return false;
    return new Date(last).toDateString() === new Date().toDateString();
}

form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (alreadySentToday()) {
        showMsg(formMsg, 'Вы уже отправляли заявку сегодня. Напишите мне в Telegram или VK — так быстрее.', 'info');
        return;
    }

    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    showMsg(formMsg, 'Отправляем заявку...', 'info');

    try {
        const response = await fetch(form.action, {
            method: 'POST',
            body: new FormData(form),
            headers: { Accept: 'application/json' },
        });

        if (!response.ok) throw new Error('bad response');

        localStorage.setItem('lastFormSubmit', new Date().toISOString());
        showMsg(formMsg, 'Заявка отправлена. Свяжусь с вами в ближайшее время.', 'ok');
        form.reset();
    } catch {
        showMsg(formMsg, 'Не получилось отправить. Попробуйте позже или напишите в Telegram.', 'err');
    } finally {
        button.disabled = false;
    }
});
