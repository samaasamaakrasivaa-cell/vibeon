// Все строки интерфейса — через ключи RU/EN.
export const LANGS = ["ru", "en"] as const;
export type LangCode = (typeof LANGS)[number];

const ru = {
  "app.name": "VibeOn",
  "ws.teacher": "Кабинет учителя",
  "ws.student": "Кабинет ученика",
  "ws.ui": "Дизайн-система",
  "common.profile": "Профиль",
  "common.logout": "Выйти",
  "common.language": "Язык",
  "common.soon": "Раздел появится на этапе {n} плана разработки.",
  "common.soonTitle": "Скоро здесь",
  "common.backHome": "На главную",

  "nav.updates": "Обновления",
  "nav.schedule": "Расписание",
  "nav.students": "Ученики",
  "nav.chat": "Чат",
  "nav.homework": "Домашка",
  "nav.questions": "Вопросы",
  "nav.courses": "Курсы",
  "nav.finance": "Финансы",
  "nav.lessons": "Мои уроки",
  "nav.words": "Слова",
  "nav.route": "Мой маршрут",
  "nav.progress": "Прогресс",
  "nav.messages": "Сообщения",
  "nav.payments": "Оплаты",

  "greet.morning": "Доброе утро,",
  "greet.day": "Добрый день,",
  "greet.evening": "Добрый вечер,",
  "greet.night": "Доброй ночи,",

  "home.title": "VibeOn — платформа для репетиторов английского",
  "home.lead": "Этап 1: основа платформы. Вход и регистрация появятся на этапе 2 — пока кабинеты открываются в демо-режиме.",
  "home.teacher": "Открыть кабинет учителя",
  "home.student": "Открыть кабинет ученика",
  "home.ui": "Посмотреть дизайн-систему",
  "home.health": "Состояние сервера",

  "dash.today": "Сегодня",
  "dash.week": "Эта неделя",
  "dash.whatsNew": "Что нового",
  "dash.empty": "Пока пусто. Данные появятся, когда будут подключены разделы.",
  "dash.noLessons": "Сегодня уроков нет.",
  "dash.lesson": "Урок",
  "dash.noComment": "Без комментария",
  "dash.min": "мин",
  "dash.openClass": "Открыть класс",
} as const;

export type DictKey = keyof typeof ru;

const en: Record<DictKey, string> = {
  "app.name": "VibeOn",
  "ws.teacher": "Teacher’s workspace",
  "ws.student": "Student’s workspace",
  "ws.ui": "Design system",
  "common.profile": "Profile",
  "common.logout": "Log out",
  "common.language": "Language",
  "common.soon": "This section arrives in stage {n} of the development plan.",
  "common.soonTitle": "Coming soon",
  "common.backHome": "Home",

  "nav.updates": "Updates",
  "nav.schedule": "Schedule",
  "nav.students": "Students",
  "nav.chat": "Chat",
  "nav.homework": "Homework",
  "nav.questions": "Questions",
  "nav.courses": "Courses",
  "nav.finance": "Finance",
  "nav.lessons": "My lessons",
  "nav.words": "Words",
  "nav.route": "My route",
  "nav.progress": "Progress",
  "nav.messages": "Messages",
  "nav.payments": "Payments",

  "greet.morning": "Good morning,",
  "greet.day": "Good afternoon,",
  "greet.evening": "Good evening,",
  "greet.night": "Good night,",

  "home.title": "VibeOn — a platform for English tutors",
  "home.lead": "Stage 1: platform foundation. Sign-in arrives in stage 2 — for now the workspaces open in demo mode.",
  "home.teacher": "Open teacher’s workspace",
  "home.student": "Open student’s workspace",
  "home.ui": "View the design system",
  "home.health": "Server status",

  "dash.today": "Today",
  "dash.week": "This week",
  "dash.whatsNew": "What’s new",
  "dash.empty": "Nothing here yet. Data appears once the sections are connected.",
  "dash.noLessons": "No lessons today.",
  "dash.lesson": "Lesson",
  "dash.noComment": "No comment",
  "dash.min": "min",
  "dash.openClass": "Open class",
};

export const dictionaries: Record<LangCode, Record<DictKey, string>> = { ru, en };

export function translate(lang: LangCode, key: DictKey, vars?: Record<string, string | number>) {
  let s: string = dictionaries[lang][key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
