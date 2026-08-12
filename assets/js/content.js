/* ==========================================================================
   Содержимое главной страницы, которое можно менять из админки.

   DEFAULT_CONTENT — тексты по умолчанию (совпадают с версткой index.html).
   Если в базе поле пустое, используется значение отсюда, поэтому страница
   всегда осмысленна, даже до первого редактирования.
   ========================================================================== */

export const DEFAULT_CONTENT = {
    hero: {
        eyebrow: 'Подготовка к ОГЭ и ЕГЭ',
        title: 'Информатика без зубрёжки — от первого алгоритма до высокого балла',
        lead: 'Ямкина Елена Владимировна — учитель информатики высшей квалификационной категории, старший эксперт региональной предметной комиссии. Занимаюсь онлайн и в Ульяновске.',
        badges: [
            'Старший эксперт предметной комиссии',
            'Высшая категория',
            'Наставник ДТЦ «Инженерка»',
        ],
    },
    stats: [
        { num: '35+', label: 'лет преподавания' },
        { num: '90', label: 'баллов — лучший результат учеников' },
        { num: '1–16', label: 'разбор каждого задания ОГЭ' },
        { num: '100%', label: 'учеников преодолевают порог' },
    ],
    about: {
        heading: 'Знаю экзамен с обеих сторон — и как учитель, и как эксперт',
        p1: 'Проверяю работы ЕГЭ как старший эксперт региональной предметной комиссии по информатике, поэтому точно знаю, за что снимают баллы и что ждёт ученика на реальном экзамене.',
        p2: 'Учитель информатики высшей квалификационной категории, наставник по программированию в ДТЦ «Инженерка». Веду авторские курсы на Stepik и занимаюсь индивидуально — от подготовки с нуля до продвинутого Python и проектной работы.',
    },
    services: [
        { title: 'Подготовка к ОГЭ', desc: 'С нуля до результата. Авторский курс на Stepik: разбор каждого задания с 1 по 16 и отработка навыка решения на большом количестве задач.' },
        { title: 'Подготовка к ЕГЭ', desc: 'Разбор типовых алгоритмов и решение задач от самых простых до сложных. Отдельно — задания на программирование и работу с файлами.' },
        { title: 'Программирование на Python', desc: 'Курс для школьников: от основ алгоритмизации до авторских задач и собственных проектов. Хорошая база для будущего ЕГЭ.' },
    ],
    prices: [
        { name: 'ОГЭ по информатике', value: '1500 ₽', unit: '/ 60 мин', features: 'Разбор заданий 1–16\nРабота в реальном интерфейсе экзамена\nДомашние задания с проверкой' },
        { name: 'ЕГЭ по информатике', value: '2000–2500 ₽', unit: '/ 60 мин', features: 'Типовые алгоритмы и сложные задачи\nПрограммирование на Python для экзамена\nПробные работы с разбором ошибок\nВзгляд эксперта предметной комиссии' },
        { name: 'Продвинутый Python', value: '1500 ₽', unit: '/ 60 мин', features: 'Алгоритмы и структуры данных\nАвторские задачи повышенной сложности\nПроектная деятельность' },
    ],
    contacts: {
        telegram: 'https://t.me/it_school_73',
        vk: 'https://vk.ru/alenka_ul',
        max: 'https://max.ru/join/RfUMt4bXMe0_Ogdfhi3f3-q7gJtHuHEp2bWW48k6rRU',
    },
};

/** Значение из сохранённого контента или значение по умолчанию. */
function pick(saved, def) {
    if (saved === undefined || saved === null || saved === '') return def;
    return saved;
}

/** Глубоко сливает сохранённый контент с дефолтом (для формы админки). */
export function mergeContent(saved = {}) {
    const d = DEFAULT_CONTENT;
    const s = saved || {};
    return {
        hero: {
            eyebrow: pick(s.hero?.eyebrow, d.hero.eyebrow),
            title: pick(s.hero?.title, d.hero.title),
            lead: pick(s.hero?.lead, d.hero.lead),
            badges: (s.hero?.badges && s.hero.badges.length) ? s.hero.badges : d.hero.badges,
        },
        stats: d.stats.map((def, i) => ({
            num: pick(s.stats?.[i]?.num, def.num),
            label: pick(s.stats?.[i]?.label, def.label),
        })),
        about: {
            heading: pick(s.about?.heading, d.about.heading),
            p1: pick(s.about?.p1, d.about.p1),
            p2: pick(s.about?.p2, d.about.p2),
        },
        services: d.services.map((def, i) => ({
            title: pick(s.services?.[i]?.title, def.title),
            desc: pick(s.services?.[i]?.desc, def.desc),
        })),
        prices: d.prices.map((def, i) => ({
            name: pick(s.prices?.[i]?.name, def.name),
            value: pick(s.prices?.[i]?.value, def.value),
            unit: pick(s.prices?.[i]?.unit, def.unit),
            features: pick(s.prices?.[i]?.features, def.features),
        })),
        contacts: {
            telegram: pick(s.contacts?.telegram, d.contacts.telegram),
            vk: pick(s.contacts?.vk, d.contacts.vk),
            max: pick(s.contacts?.max, d.contacts.max),
        },
    };
}

/** Подставляет контент в разметку главной страницы. */
export function applyContent(saved) {
    const c = mergeContent(saved);
    const set = (sel, text) => {
        const el = document.querySelector(sel);
        if (el) el.textContent = text;
    };
    const setHref = (sel, url) => {
        if (!url) return;
        document.querySelectorAll(sel).forEach(el => el.setAttribute('href', url));
    };

    // Шапка. Заголовок трогаем только если его действительно меняли —
    // иначе в вёрстке по умолчанию сохраняется зелёный акцент.
    set('[data-c="hero.eyebrow"]', c.hero.eyebrow);
    if (saved?.hero?.title && saved.hero.title !== DEFAULT_CONTENT.hero.title) {
        set('[data-c="hero.title"]', c.hero.title);
    }
    set('[data-c="hero.lead"]', c.hero.lead);
    const badges = document.querySelector('[data-c="hero.badges"]');
    if (badges) {
        badges.innerHTML = '';
        c.hero.badges.filter(Boolean).forEach(text => {
            const li = document.createElement('li');
            li.textContent = text;
            badges.appendChild(li);
        });
    }

    // Статистика
    c.stats.forEach((s, i) => {
        set(`[data-c="stats.${i}.num"]`, s.num);
        set(`[data-c="stats.${i}.label"]`, s.label);
    });

    // Обо мне
    set('[data-c="about.heading"]', c.about.heading);
    set('[data-c="about.p1"]', c.about.p1);
    set('[data-c="about.p2"]', c.about.p2);

    // Услуги
    c.services.forEach((s, i) => {
        set(`[data-c="services.${i}.title"]`, s.title);
        set(`[data-c="services.${i}.desc"]`, s.desc);
    });

    // Цены
    c.prices.forEach((p, i) => {
        set(`[data-c="prices.${i}.name"]`, p.name);
        set(`[data-c="prices.${i}.value"]`, p.value);
        set(`[data-c="prices.${i}.unit"]`, p.unit);
        const ul = document.querySelector(`[data-c="prices.${i}.features"]`);
        if (ul) {
            ul.innerHTML = '';
            String(p.features).split('\n').map(s => s.trim()).filter(Boolean).forEach(text => {
                const li = document.createElement('li');
                li.textContent = text;
                ul.appendChild(li);
            });
        }
    });

    // Контакты
    setHref('[data-c="contacts.telegram"]', c.contacts.telegram);
    setHref('[data-c="contacts.vk"]', c.contacts.vk);
    setHref('[data-c="contacts.max"]', c.contacts.max);
}
