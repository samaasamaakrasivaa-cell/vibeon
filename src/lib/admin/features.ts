// Возможности платформы для тарифов и статусы доступа учителя — общее для сервера и интерфейса.

export const FEATURES: { key: string; ru: string; en: string; group: "core" | "plus" | "pro" }[] = [
  { key: "schedule", ru: "Расписание и напоминания", en: "Schedule & reminders", group: "core" },
  { key: "students", ru: "Ученики и анкеты", en: "Students & profiles", group: "core" },
  { key: "payments", ru: "Оплаты и абонементы", en: "Payments & packs", group: "core" },
  { key: "chat", ru: "Чат с учениками", en: "Chat with students", group: "core" },
  { key: "courses", ru: "Курсы и конструктор уроков", en: "Courses & lesson builder", group: "core" },
  { key: "homework", ru: "Домашка и проверка", en: "Homework & review", group: "core" },
  { key: "words", ru: "Слова и тренировки", en: "Words & training", group: "core" },
  { key: "placement", ru: "Placement test", en: "Placement test", group: "core" },
  { key: "telegram", ru: "Telegram-бот для учеников", en: "Telegram bot", group: "core" },
  { key: "board", ru: "Онлайн-доска на уроке", en: "Whiteboard", group: "core" },
  { key: "groups", ru: "Групповые уроки", en: "Group lessons", group: "plus" },
  { key: "awards", ru: "Статусы и награды", en: "Titles & awards", group: "plus" },
  { key: "finance", ru: "Финансы и аналитика", en: "Finance & analytics", group: "plus" },
  { key: "reports", ru: "PDF-отчёты ученикам и родителям", en: "PDF reports", group: "plus" },
  { key: "ai_check", ru: "ИИ-проверка письма и говорения", en: "AI writing & speaking check", group: "plus" },
  { key: "ai_import", ru: "ИИ-импорт уроков из книг", en: "AI lesson import", group: "pro" },
  { key: "support", ru: "Приоритетная поддержка", en: "Priority support", group: "pro" },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);

export type AccessState = "trial" | "paid" | "expired" | "blocked";

/** Состояние доступа учителя: заблокирован → оплачен → пробный → истёк. */
export function accessOf(p: { blockedAt: Date | null; paidUntil: Date | null; trialUntil: Date | null }, now = new Date()): { state: AccessState; until: Date | null } {
  if (p.blockedAt) return { state: "blocked", until: null };
  if (p.paidUntil && p.paidUntil > now) return { state: "paid", until: p.paidUntil };
  if (p.trialUntil && p.trialUntil > now) return { state: "trial", until: p.trialUntil };
  return { state: "expired", until: p.paidUntil ?? p.trialUntil };
}

export const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
