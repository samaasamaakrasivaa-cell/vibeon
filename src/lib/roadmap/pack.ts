import "server-only";
// «Комплект разбора» для маршрута: всё, что известно после placement test, в одном систематизированном виде,
// плюс статистика аккаунта (уроки, домашки, время на платформе, срезы). Его читает учитель (блок «Результаты теста»)
// и ИИ — первым шагом, до анкеты. Имён и контактов внутри нет.
import { db } from "../db";
import { getBank, trackOf } from "../placement/bank";
import { rubricOf } from "../placement/rubric";
import { summarizeV6 } from "../placement/engine";
import { draftTexts, R_TEXT, type RSaved } from "../placement/report";
import { reportData } from "../placement/report-data";
import { stateOf } from "../placement/run";

type Err = { q: string; given: string; right: string; explain: string };
export type TestPack = {
  max?: number;
  attemptId: string; date: string; level: string | null; status: string;
  skills: { key: string; name: string; step: string | null; pct: number | null }[];
  grammarTopics: { id?: string; name: string; level: string; c: number; n: number; verdict: "own" | "part" | "gap" | null }[]; // v6: темы с итогом
  grammarErrors: { topic: string; level: string; items: Err[] }[];
  vocabErrors: { topic: string; level: string; items: Err[] }[];
  families: { name: string; c: number; n: number }[];
  reading: { level: string; c: number; n: number }[]; listening: { level: string; c: number; n: number }[];
  writing: { level: string; marks: { name: string; v: number | null; note: string }[]; note: string; text: string } | null;
  speaking: { level: string; marks: { name: string; v: number | null; note: string }[]; note: string } | null;
  report: { strong: string; work: string; plan: string; comment: string; level: string; sent: boolean };
};

const avgPct = (xs: (number | null)[], max = 3) => { const v = xs.filter((x): x is number => typeof x === "number"); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length / max) * 100) : null; };

/** Письмо и говорение в процентах — средний балл учителя по критериям (0–5 или прежние 0–3). Для полосок навыков. */
export function wsPercent(review: unknown) {
  const rv = (review ?? {}) as { writing?: Record<string, number>; speaking?: Record<string, number>; lesson?: { marks: Record<string, number> } | null };
  const set = rubricOf(rv as never);
  const w = avgPct(set.writing.map((c) => rv.writing?.[c.id] ?? null), set.max);
  const sm = set.speaking.every((c) => typeof rv.lesson?.marks[c.id] === "number") ? rv.lesson!.marks : rv.speaking ?? rv.lesson?.marks;
  const s = avgPct(set.speaking.map((c) => sm?.[c.id] ?? null), set.max);
  return { ...(w !== null ? { writing: w } : {}), ...(s !== null ? { speaking: s } : {}) };
}

/** Комплект по последнему проверенному placement test ученика. */
export async function testPack(studentId: string, teacherId: string): Promise<TestPack | null> {
  const a = await db.placementAttempt.findFirst({
    where: { studentId, teacherId, status: { in: ["reviewed", "submitted"] } },
    orderBy: [{ reviewedAt: "desc" }, { submittedAt: "desc" }], include: { student: true },
  });
  if (!a) return null;
  const st = stateOf(a.state);
  const r = await reportData(a, st);
  const { bank } = await getBank(trackOf(st.track));
  const cp = a.checkpointId ? await db.checkpoint.findUnique({ where: { id: a.checkpointId }, select: { results: true } }) : null;
  const pct: Record<string, number> = { ...(((cp?.results ?? {}) as { skills?: Record<string, number> }).skills ?? {}), ...wsPercent(a.review) };
  const S = r.input.skills;
  const skills = ([["grammar", "core", "Грамматика"], ["vocabulary", "vocab", "Лексика"], ["reading", "reading", "Чтение"], ["listening", "listening", "Аудирование"], ["writing", "writing", "Письмо"], ["speaking", "speaking", "Говорение"]] as const)
    .map(([key, rk, name]) => ({ key, name, step: S[rk] ?? null, pct: pct[key] ?? null }));
  // ошибки по темам: сначала темы, где ошибок больше
  const group = (vocab: boolean) => {
    const m = new Map<string, { topic: string; level: string; items: Err[] }>();
    for (const x of r.d.core) {
      if (x.ok || x.vocab !== vocab) continue;
      const g = m.get(x.topic) ?? { topic: x.topic, level: x.level, items: [] };
      g.items.push({ q: x.q, given: x.dk ? "«Не знаю»" : x.given, right: x.right, explain: x.explain ?? "" });
      m.set(x.topic, g);
    }
    return [...m.values()].sort((p, q) => q.items.length - p.items.length);
  };
  let grammarTopics: TestPack["grammarTopics"] = [];
  if (st.ld?.length) {
    try { grammarTopics = summarizeV6(st, bank).topics.filter((t) => t.n > 0).map((t) => ({ id: t.id, name: t.name, level: t.level, c: t.c, n: t.n, verdict: t.verdict })); } catch { /* старые попытки без v6 */ }
  }
  const text = (kind: "reading" | "listening") => r.d[kind === "reading" ? "reading" : "listening"].map((x) => ({ level: x.level, c: x.questions.filter((q) => q.ok).length, n: x.questions.length }));
  // отчёт: тексты учителя (с правками) поверх черновика системы — вариант «для ученика», русский
  const saved = (r.saved ?? {}) as RSaved;
  const cfg = saved.student;
  const draft = draftTexts(r.input, "student", "ru");
  const tx = Object.fromEntries(R_TEXT.map((b) => [b, (cfg?.texts?.[`ru:${b}`] ?? cfg?.texts?.[`${cfg?.lang ?? "ru"}:${b}`] ?? draft[b] ?? "").trim()]));
  return {
    attemptId: a.id, date: r.date.slice(0, 10), level: a.level ?? r.input.level, status: a.status, skills, grammarTopics,
    grammarErrors: group(false), vocabErrors: group(true),
    families: r.input.families.map((f) => ({ name: f.name, c: f.c, n: f.n })),
    reading: text("reading"), listening: text("listening"),
    max: r.max,
    writing: r.writing ? { level: r.writing.level, marks: r.writing.marks.map((x) => ({ name: x.name, v: x.v, note: x.note })), note: r.writing.note, text: (r.writing.text ?? "").slice(0, 2500) } : null,
    speaking: r.speaking ? { level: r.speaking.level, marks: r.speaking.marks.map((x) => ({ name: x.name, v: x.v, note: x.note })), note: r.speaking.note } : null,
    report: { strong: tx.strong ?? "", work: tx.work ?? "", plan: tx.plan ?? "", comment: (tx.comment || r.input.comment || "").trim(), level: tx.level ?? "", sent: !!saved.sent },
  };
}

export type AccountStats = {
  lessons: { total: number; last4w: number; hours4w: number };
  homework: { assigned8w: number; done8w: number };
  minutesPerWeek: number[]; // последние 4 недели, от старой к новой; самостоятельно (без уроков)
  tests: { date: string; kind: string; level: string | null; skills: Record<string, number> }[];
};

/** Динамика по аккаунту: пока данных мало, но со вторым-третьим срезом это главное для пересборки маршрута. */
export async function accountStats(studentId: string): Promise<AccountStats> {
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } });
  const now = Date.now(), w4 = new Date(now - 28 * 864e5), w8 = new Date(now - 56 * 864e5);
  const [total, recent, hws, days, cps] = await Promise.all([
    db.lessonInstance.count({ where: { studentId, status: "DONE", isTrial: false } }),
    db.lessonInstance.findMany({ where: { studentId, status: "DONE", isTrial: false, startsAt: { gte: w4 } }, select: { durationMin: true } }),
    db.homework.findMany({ where: { lessonInstance: { studentId, startsAt: { gte: w8 } } }, select: { status: true } }),
    s.userId ? db.activityDay.findMany({ where: { userId: s.userId, day: { gte: w4.toISOString().slice(0, 10) } }, select: { day: true, minutes: true, lessonMinutes: true } }) : Promise.resolve([]),
    db.checkpoint.findMany({ where: { studentId, status: "done" }, orderBy: { takenAt: "asc" }, select: { takenAt: true, kind: true, level: true, results: true } }),
  ]);
  const weeks = [0, 0, 0, 0];
  for (const d of days) { const i = 3 - Math.floor((now - new Date(`${d.day}T12:00:00Z`).getTime()) / (7 * 864e5)); if (i >= 0 && i < 4) weeks[i] += Math.max(0, d.minutes - d.lessonMinutes); }
  return {
    lessons: { total, last4w: recent.length, hours4w: Math.round((recent.reduce((a, l) => a + l.durationMin, 0) / 60) * 10) / 10 },
    homework: { assigned8w: hws.length, done8w: hws.filter((h) => h.status === "SUBMITTED" || h.status === "REVIEWED").length },
    minutesPerWeek: weeks,
    tests: cps.map((c) => ({ date: c.takenAt?.toISOString().slice(0, 10) ?? "", kind: c.kind, level: c.level, skills: ((c.results ?? {}) as { skills?: Record<string, number> }).skills ?? {} })),
  };
}
