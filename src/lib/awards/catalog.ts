// Статусы учеников: каталог титулов (качества) и поощрений (моменты), значки и металлы медалей.
// Общий модуль — нужен и на сервере, и в окне выдачи у учителя.

export type AwardKind = "title" | "cheer";
export type Term = "week" | "month" | "forever";
export type Metal = "gold" | "silver" | "rose" | "sapphire" | "amethyst" | "emerald";
type L = { ru: string; en: string };
/** Имя с формами по полу: «Король / Королева языковой догадки». */
type GName = { ru: string | { f: string; m: string }; en: string };

export type CatalogItem = { key: string; kind: AwardKind; group: string; name: GName; why: L; icon: IconKey; color: Metal; term: Term };

/** Металлы: обод, лицевая сторона, цвет значка, тень — как награды Apple Watch. */
export const METALS: Record<Metal, { ring: string; face: string; ink: string; shadow: string; text: string; ru: string; en: string }> = {
  gold: { ring: "linear-gradient(145deg,#FFF3C4 0%,#F4C24E 32%,#C98A12 72%,#8A5A00 100%)", face: "radial-gradient(circle at 32% 26%,#FFEDB0 0%,#F3B83E 52%,#B9790C 100%)", ink: "#FFF6DA", shadow: "rgba(170,110,0,.35)", text: "#8A5A00", ru: "Золото", en: "Gold" },
  silver: { ring: "linear-gradient(145deg,#FFFFFF 0%,#D9DEE7 35%,#9AA4B5 75%,#6B7486 100%)", face: "radial-gradient(circle at 32% 26%,#F7F9FC 0%,#C3CAD6 55%,#808A9C 100%)", ink: "#FFFFFF", shadow: "rgba(80,90,110,.3)", text: "#4A5262", ru: "Серебро", en: "Silver" },
  rose: { ring: "linear-gradient(145deg,#FFEDE4 0%,#F2B39A 35%,#C7735A 75%,#8E4A36 100%)", face: "radial-gradient(circle at 32% 26%,#FFE2D6 0%,#E89A7E 55%,#B0604A 100%)", ink: "#FFF3EE", shadow: "rgba(170,90,60,.3)", text: "#8E4A36", ru: "Розовое золото", en: "Rose gold" },
  sapphire: { ring: "linear-gradient(145deg,#DCEBFF 0%,#6FA4FF 35%,#2A62D9 75%,#163D99 100%)", face: "radial-gradient(circle at 32% 26%,#CFE2FF 0%,#4F8DF5 55%,#1F4FBF 100%)", ink: "#EEF5FF", shadow: "rgba(31,86,214,.32)", text: "#1F4FBF", ru: "Сапфир", en: "Sapphire" },
  amethyst: { ring: "linear-gradient(145deg,#F1E3FF 0%,#B98CF5 35%,#7C47DB 75%,#4A2399 100%)", face: "radial-gradient(circle at 34% 26%,#E3CCFF 0%,#9D63EE 55%,#5B2CB5 100%)", ink: "#F6EEFF", shadow: "rgba(100,50,200,.32)", text: "#5B2CB5", ru: "Аметист", en: "Amethyst" },
  emerald: { ring: "linear-gradient(145deg,#D9FBE8 0%,#5ED69A 35%,#1F9E66 75%,#0E6A45 100%)", face: "radial-gradient(circle at 32% 26%,#C9F5DD 0%,#3BC383 55%,#13804F 100%)", ink: "#EEFFF6", shadow: "rgba(20,130,80,.32)", text: "#13804F", ru: "Изумруд", en: "Emerald" },
};
export const METAL_KEYS = Object.keys(METALS) as Metal[];

/** Значки (контур, viewBox 24). */
export const ICONS = {
  crown: "M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3zM8.5 12l2.5 2.5 4.5-5",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7l1-8z",
  lens: "M11 5a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM20 20l-4.5-4.5",
  gem: "M6 3h12l3 6-9 12L3 9l3-6zM3 9h18",
  chat: "M4 5h16v11H9l-5 4V5zM8 9h8M8 12h5",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
  feather: "M20 4c-6 0-12 4-14 12l-2 4M8 16h6c4-2 6-7 6-12",
  compass: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM15.5 8.5l-2 5-5 2 2-5 5-2z",
  road: "M4 21l4-18M20 21l-4-18M12 4v3M12 11v3M12 18v3",
  sprout: "M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 10c0-3 2-5 6-5 0 3-2 5-6 5z",
  rocket: "M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-5-5 6-6zM9 10l-4 1 3 3M14 15l-1 4-3-3M5 15c-1 2-1 4-1 4s2 0 4-1",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8",
  mountain: "M3 20l6-11 4 6 2-3 6 8H3z",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  palette: "M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-2 0-3h3a4 4 0 0 0 4-4c0-5-4-9-9-9zM7.5 11h.01M10 7.5h.01M15 7.5h.01",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM19 19v2H6",
  globe: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  parachute: "M3 11a9 9 0 0 1 18 0M3 11l9 9 9-9M8 11l4 9 4-9",
  target: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z",
  laurel: "M8 20c-3-3-4-7-3-12M16 20c3-3 4-7 3-12M6 12l-2-1M5 16H3M18 12l2-1M19 16h2M7 8L5 6M17 8l2-2",
  cal: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4M9 15l2 2 4-4",
  medal: "M8 3l4 6 4-6M12 21a6 6 0 1 0 0-12a6 6 0 1 0 0 12zM12 13v4",
  up: "M12 20V8M6 13l6-6 6 6M4 4h16",
  back: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4",
  screen: "M3 5h18v12H3zM8 21h8M12 17v4",
  thumb: "M7 11v9H4v-9h3zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7",
  wave: "M3 12h2l2-5 3 10 3-14 3 10 2-6h3",
} as const;
export type IconKey = keyof typeof ICONS;
export const ICON_KEYS = Object.keys(ICONS) as IconKey[];

const t = (key: string, group: string, ru: GName["ru"], en: string, whyRu: string, whyEn: string, icon: IconKey, color: Metal, term: Term): CatalogItem =>
  ({ key, kind: "title", group, name: { ru, en }, why: { ru: whyRu, en: whyEn }, icon, color, term });
const c = (key: string, group: string, ru: GName["ru"], en: string, whyRu: string, whyEn: string, icon: IconKey, color: Metal): CatalogItem =>
  ({ key, kind: "cheer", group, name: { ru, en }, why: { ru: whyRu, en: whyEn }, icon, color, term: "forever" });

/** Группы — в порядке показа. */
export const GROUPS: { key: string; kind: AwardKind; ru: string; en: string }[] = [
  { key: "discipline", kind: "title", ru: "Дисциплина", en: "Discipline" },
  { key: "mind", kind: "title", ru: "Мышление", en: "Thinking" },
  { key: "skills", kind: "title", ru: "Навыки", en: "Skills" },
  { key: "growth", kind: "title", ru: "Рост", en: "Growth" },
  { key: "breakthrough", kind: "cheer", ru: "Прорывы", en: "Breakthroughs" },
  { key: "brave", kind: "cheer", ru: "Смелые шаги", en: "Brave steps" },
  { key: "milestones", kind: "cheer", ru: "Вехи", en: "Milestones" },
  { key: "nice", kind: "cheer", ru: "Приятности", en: "Kudos" },
];

export const CATALOG: CatalogItem[] = [
  // ── титулы: дисциплина и вовлечённость
  t("iron", "discipline", "Железная дисциплина", "Iron discipline", "Ни одного пропуска и переноса за месяц. Ты всегда на месте — это основа любого результата.", "Not a single missed or moved lesson this month.", "shield", "silver", "month"),
  t("hw_honor", "discipline", "Домашка — дело чести", "Homework is a matter of honour", "Все домашние задания — вовремя, без единого долга.", "Every homework on time, no debts.", "cal", "emerald", "month"),
  t("marathon", "discipline", { f: "Марафонка длинной дистанции", m: "Марафонец длинной дистанции" }, "Long-distance runner", "Месяц за месяцем занимаешься стабильно — без перерывов и рывков. Именно так и растёт уровень.", "Month after month of steady work — that's how the level grows.", "road", "gold", "forever"),
  t("always", "discipline", "Всегда в строю", "Always present", "Ни одного пропуска за всё время занятий.", "Not a single missed lesson, ever.", "medal", "silver", "forever"),
  t("captain", "discipline", "Капитан своего курса", "Captain of my course", "Сам(а) ставишь цели, предлагаешь темы и ведёшь своё обучение.", "Sets goals, suggests topics and leads their own learning.", "compass", "amethyst", "forever"),
  // ── мышление
  t("guess", "mind", { f: "Королева языковой догадки", m: "Король языковой догадки" }, "Monarch of language guessing", "Понимаешь слова по смыслу раньше, чем я успеваю их объяснить.", "Understands words from context before I explain them.", "crown", "gold", "month"),
  t("sharp", "mind", "Острый ум", "Sharp mind", "Схватываешь на лету: новое понимаешь с первого объяснения.", "Picks things up on the fly — gets it the first time.", "bolt", "sapphire", "month"),
  t("explorer", "mind", { f: "Исследовательница языка", m: "Исследователь языка" }, "Language explorer", "Задаёшь глубокие вопросы и хочешь понять, как устроен язык, — а не просто запомнить.", "Asks deep questions to understand how the language works.", "lens", "sapphire", "forever"),
  t("eagle", "mind", "Глаз-алмаз", "Eagle eye", "Замечаешь мельчайшие детали: окончания, предлоги, артикли.", "Notices the tiniest details: endings, prepositions, articles.", "gem", "amethyst", "month"),
  t("ideas", "mind", "Генератор идей", "Idea generator", "Придумываешь свои примеры, истории и неожиданные ответы — с тобой урок живой.", "Comes up with own examples, stories and surprising answers.", "palette", "rose", "month"),
  // ── навыки
  t("dialog", "skills", "Мастер диалога", "Master of dialogue", "Легко поддерживаешь разговор: отвечаешь развёрнуто, задаёшь встречные вопросы.", "Keeps a conversation going easily, with full answers and questions back.", "chat", "rose", "month"),
  t("ear", "skills", "Тонкий слух", "Fine ear", "Понимаешь на слух даже быструю живую речь — фильмы, подкасты, носителей.", "Understands even fast natural speech.", "music", "gold", "month"),
  t("accent", "skills", "Бархатный акцент", "Velvet accent", "Красивое, чистое произношение — тебя приятно слушать.", "Beautiful, clear pronunciation.", "wave", "amethyst", "forever"),
  t("pen", "skills", "Золотое перо", "Golden pen", "Пишешь грамотно и красиво: тексты читаются легко.", "Writes accurately and beautifully.", "feather", "gold", "month"),
  t("lord", "skills", { f: "Повелительница …", m: "Повелитель …" }, "Master of …", "За то, что тема полностью освоена.", "For fully mastering the topic.", "star", "amethyst", "forever"),
  // ── рост
  t("wings", "growth", "Расправил(а) крылья", "Spread their wings", "Стал(а) заметно увереннее: говоришь смелее и меньше боишься ошибок.", "Much more confident: speaks bolder and fears mistakes less.", "sprout", "emerald", "forever"),
  // ── поощрения
  c("week_break", "breakthrough", "Прорыв недели", "Breakthrough of the week", "Наконец поддалась тема, которая долго не давалась.", "A tough topic finally clicked.", "bolt", "gold"),
  c("month_break", "breakthrough", "Прорыв месяца", "Breakthrough of the month", "Самый заметный рост за месяц.", "The biggest growth this month.", "rocket", "gold"),
  c("year_break", "breakthrough", "Прорыв года", "Breakthrough of the year", "Огромный путь за год — вспомни, с чего мы начинали.", "A huge journey in a year.", "rocket", "amethyst"),
  c("level", "breakthrough", "Новый уровень", "New level", "Подтверждено тестом: новый уровень.", "Confirmed by a test: a new level.", "up", "emerald"),
  c("no_net", "brave", "Без страховки", "No safety net", "Первый урок полностью на английском — ни слова по-русски.", "A whole lesson in English only.", "parachute", "rose"),
  c("real_life", "brave", "Английский в жизни", "English in real life", "Использовал(а) язык за пределами урока: в поездке, на работе, в переписке.", "Used English outside the lesson.", "globe", "sapphire"),
  c("no_subs", "brave", "Без субтитров", "No subtitles", "Посмотрел(а) фильм или серию без субтитров — и понял(а).", "Watched without subtitles and understood.", "screen", "amethyst"),
  c("lessons", "milestones", "10 уроков вместе", "10 lessons together", "Юбилей наших занятий!", "A lesson anniversary!", "laurel", "silver"),
  c("year", "milestones", "Год с английским", "A year of English", "Целый год занятий — это уже привычка на всю жизнь.", "A whole year of lessons.", "laurel", "gold"),
  c("back", "milestones", { f: "Возвращение героини", m: "Возвращение героя" }, "The hero returns", "Здорово, что ты снова с нами после перерыва.", "Great to have you back after a break.", "back", "sapphire"),
  c("great", "nice", "Отличная работа!", "Great job!", "За сегодняшний урок или домашку.", "For today's lesson or homework.", "thumb", "emerald"),
  c("sunny", "nice", "Солнце урока", "Sunshine of the lesson", "С тобой урок пролетел на одном дыхании.", "The lesson flew by with you.", "sun", "gold"),
  c("effort", "nice", "Спасибо за старание", "Thanks for the effort", "Видно, сколько сил ты вложил(а).", "Your effort shows.", "heart", "rose"),
];

/** Имя статуса: по языку и полу; пол не указан — «Королева / Король». */
export function nameFor(it: CatalogItem, lang: "ru" | "en", gender: string | null | undefined) {
  if (lang === "en") return it.name.en;
  const n = it.name.ru;
  if (typeof n === "string") return n;
  return gender === "m" ? n.m : gender === "f" ? n.f : `${n.f} / ${n.m}`;
}

/** Срок титула по умолчанию → дата окончания. */
export function untilOf(term: Term, from = new Date()): Date | null {
  if (term === "forever") return null;
  return new Date(from.getTime() + (term === "week" ? 7 : 31) * 864e5);
}
