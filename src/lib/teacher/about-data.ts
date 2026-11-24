// Анкета преподавателя, которую видят его ученики: кто он как специалист и чего ждать от занятий.

export type TeacherAbout = {
  photo?: string; // фото (загруженный файл)
  headline?: string; // одной строкой: «Преподаватель английского · IELTS и бизнес-английский»
  bio?: string; // о себе
  since?: string; // преподаю с (год)
  ownLevel?: string; // свой уровень английского: C1, C2, Native
  education?: string; // образование: вуз, специальность, годы
  certs?: string[]; // сертификаты и квалификации: CELTA, DELTA, TKT, IELTS 8.0…
  specs?: string[]; // направления (ключи SPECS)
  audience?: string[]; // с кем работаю (ключи AUDIENCE)
  levels?: string; // уровни учеников: «A2–C1»
  approach?: string; // подход и методика
  format?: string; // как проходят занятия: длительность, платформа, домашка, обратная связь
  results?: string; // результаты учеников
  experience?: string; // опыт: где преподавал, сколько учеников, стажировки
  languages?: string; // какие языки знаю
  interests?: string; // интересы — о чём можно поговорить на уроке
  video?: string; // ссылка на видео-знакомство
  links?: string; // соцсети, сайт, портфолио (по строке)
  show?: boolean; // показывать ученикам
};

export const SPECS = ["general", "speaking", "grammar", "business", "ielts", "toefl", "cambridge", "ege", "oge", "travel", "it", "academic", "pronunciation", "relocation"] as const;
export const AUDIENCE = ["kids", "teens", "adults", "corporate", "beginners", "advanced"] as const;

export const TEXT_FIELDS = ["photo", "headline", "bio", "since", "ownLevel", "education", "levels", "approach", "format", "results", "experience", "languages", "interests", "video", "links"] as const;
const MAX: Record<string, number> = { headline: 140, since: 4, ownLevel: 20, levels: 40, video: 300, photo: 300 };

/** Чистка входных данных: строки обрезаются, списки — только известные ключи или до 12 коротких пунктов. */
export function cleanAbout(x: unknown): TeacherAbout {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const out: TeacherAbout = {};
  for (const k of TEXT_FIELDS) {
    const v = typeof o[k] === "string" ? (o[k] as string).trim().slice(0, MAX[k] ?? 3000) : "";
    if (v) (out as Record<string, unknown>)[k] = v;
  }
  if (out.since && !/^(19|20)\d\d$/.test(out.since)) delete out.since;
  if (out.photo && !out.photo.startsWith("/api/files/")) delete out.photo;
  if (out.video && !/^https?:\/\//.test(out.video)) delete out.video;
  const list = (v: unknown, allowed?: readonly string[]) => (Array.isArray(v) ? [...new Set(v.map(String).map((s) => s.trim().slice(0, 80)).filter(Boolean))].filter((s) => !allowed || allowed.includes(s)).slice(0, 12) : []);
  const certs = list(o.certs), specs = list(o.specs, SPECS), audience = list(o.audience, AUDIENCE);
  if (certs.length) out.certs = certs;
  if (specs.length) out.specs = specs;
  if (audience.length) out.audience = audience;
  out.show = o.show !== false;
  return out;
}

/** Есть что показать ученику: хотя бы пара содержательных полей. */
export const aboutFilled = (a: TeacherAbout) => [a.headline, a.bio, a.education, a.approach, a.experience, a.certs?.length, a.specs?.length].filter(Boolean).length >= 2;

/** Сколько лет преподаёт — по году начала. */
export const yearsOf = (since?: string) => { const y = Number(since); return y ? Math.max(0, new Date().getFullYear() - y) : 0; };
