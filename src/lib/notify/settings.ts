// Настройки уведомлений: какие темы куда приходят. Внутри платформы (колокольчик) — всегда.

export const CATS = ["lessons", "messages", "payments", "progress", "words"] as const;
export type Cat = (typeof CATS)[number];
export type NotifySettings = { tg: Partial<Record<Cat, boolean>>; email: Partial<Record<Cat, boolean>>; lessonLead: number; quiet: [number, number] | null };

/** Тема уведомления по его виду. */
export function catOf(kind: string): Cat {
  if (["lesson", "lesson_done", "homework", "hw_due"].includes(kind)) return "lessons";
  if (["message", "question", "answer", "reply"].includes(kind)) return "messages";
  if (["invoice", "paid", "receipt", "payment", "pack_request"].includes(kind)) return "payments";
  if (["test", "roadmap", "report"].includes(kind)) return "progress";
  if (kind === "words") return "words";
  return "lessons";
}

export const LEADS = [0, 15, 30, 60, 120, 1440];

export function defaults(role: "TEACHER" | "STUDENT"): NotifySettings {
  return role === "TEACHER"
    ? { tg: { lessons: true, messages: true, payments: true, progress: true, words: false }, email: { payments: true }, lessonLead: 30, quiet: [22, 8] }
    : { tg: { lessons: true, messages: true, payments: true, progress: true, words: true }, email: { payments: true, progress: true }, lessonLead: 60, quiet: [22, 8] };
}

export function settingsOf(role: "TEACHER" | "STUDENT", raw: unknown): NotifySettings {
  const d = defaults(role), r = (raw ?? {}) as Partial<NotifySettings>;
  return {
    tg: { ...d.tg, ...(r.tg ?? {}) }, email: { ...d.email, ...(r.email ?? {}) },
    lessonLead: LEADS.includes(Number(r.lessonLead)) ? Number(r.lessonLead) : d.lessonLead,
    quiet: r.quiet === null ? null : Array.isArray(r.quiet) && r.quiet.length === 2 ? [Number(r.quiet[0]) % 24, Number(r.quiet[1]) % 24] : d.quiet,
  };
}
