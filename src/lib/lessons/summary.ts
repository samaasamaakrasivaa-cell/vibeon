import "server-only";
// Итог урока по ученику: каждый пункт каждого задания (верно с первой попытки / в итоге), тема пункта по меткам,
// вес формата (найди и исправь > перевод > вписать > выбор). Ответы, помеченные неверными в заданиях со свободной
// формой, проверяет ИИ: ключ ответов бывает неполным. Решение «Засчитать / Оставить ошибкой» — за учителем.
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { llmFor } from "../ai/gateway";
import { modelsFor } from "../ai/models";
import { prompt } from "../ai/prompts";
import { runJson } from "../ai/route-core";
import { parse, same, dictationGrade, type Seg } from "../tasks/parse";
import { progressOf } from "../tasks/progress";
import type { TaskOptions, TaskType } from "../tasks/catalog";
import { FORMAT_WEIGHT, topicLabel, type TaskTags } from "../tasks/tags";
import { tagTemplate } from "../tasks/tagging";

type P = Record<string, unknown>;
const rec = <T,>(x: unknown) => ((x && typeof x === "object" ? x : {}) as Record<string, T>);
const filled = (v: unknown) => (typeof v === "string" ? !!v.trim() : v != null);
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export type Item = { key: string; idx: number; ok: boolean; firstOk: boolean; typed: boolean; ctx: string; expected: string; given: string };
export type Verdict = "correct" | "topic_error" | "other_error" | "typo" | "unverified";
export type Check = { id: string; taskId: string; key: string; title: string; ctx: string; expected: string; given: string; topicKey: string; verdict: Verdict; why: string; status: "pending" | "accepted" | "kept" };
export type TopicStat = { key: string; topic?: string; name: string; skill?: string; items: number; firstOk: number; ok: number; score: number; ms: number; tasks: number };
export type Notes = { hardest?: { taskId: string; title: string; wrong: number; items: number }; longest?: { taskId: string; title: string; ms: number }; words: string[]; points: string[]; other: number; typos: number };

/** Пункты задания с ответом ученика: что ответил, что ожидалось, верно ли с первой попытки. */
export function itemsOf(task: { type: string; content: string; options: TaskOptions }, a: P): Item[] {
  const type = task.type as TaskType, p = parse(type, task.content), hist = rec<{ ok?: boolean }[]>(a.hist);
  // первая попытка; если ключ потом дополнили («Добавить в варианты ответа») — перепроверяем её по текущему ключу
  const first = (k: string, ok: boolean, answers?: string[]) => {
    const h = hist[k] as { ok?: boolean; v?: unknown }[] | undefined;
    if (!Array.isArray(h) || !h.length) return ok;
    if (answers?.length && typeof h[0]?.v === "string") return !!h[0].ok || same(h[0].v, answers);
    return !!h[0]?.ok;
  };
  const out: Item[] = [];
  if ((type === "gap" || type === "drag" || type === "dropdown") && p.kind === "gaps") {
    const val = rec<string>(a.val); let idx = 0;
    p.lines.forEach((l, li) => l.forEach((s, si) => {
      if (s.t !== "gap") return;
      const k = `${li}:${si}`, v = val[k], i = idx++;
      if (!filled(v)) return;
      const ok = same(v, s.answers);
      const ctx = l.map((x, j) => (x.t === "text" ? x.v : j === si ? "___" : (x as Extract<Seg, { t: "gap" }>).answers[0] ?? "")).join("").trim();
      out.push({ key: k, idx: i, ok, firstOk: first(k, ok, s.answers), typed: type === "gap" && !s.options?.length, ctx, expected: s.answers.join(" / "), given: String(v) });
    }));
  } else if (type === "errors" && p.kind === "gaps") {
    const found = rec<boolean>(a.found), fix = rec<string>(a.fix);
    p.lines.forEach((l, i) => {
      const g = l.find((s) => s.t === "gap") as Extract<Seg, { t: "gap" }> | undefined;
      const text = l.map((x) => (x.t === "text" ? x.v : (x as { hint?: string }).hint ?? "")).join("").trim();
      if (!g) { if (found[i]) out.push({ key: String(i), idx: i, ok: false, firstOk: false, typed: false, ctx: text, expected: "(в строке нет ошибки)", given: "нашёл ошибку" }); return; }
      if (!found[i] && !filled(fix[i])) return;
      const ok = same(fix[i] ?? "", g.answers);
      out.push({ key: String(i), idx: i, ok, firstOk: first(String(i), ok, g.answers), typed: true, ctx: text, expected: g.answers.join(" / "), given: String(fix[i] ?? "") });
    });
  } else if (type === "test" && p.kind === "test") {
    const sel = rec<number[]>(a.ans), tries = rec<number>(a.tries);
    p.qs.forEach((q, i) => {
      if (!sel[i]?.length) return;
      const ok = [...sel[i]].sort().join() === [...q.correct].sort().join();
      out.push({ key: String(i), idx: i, ok, firstOk: ok && !(Number(tries[i]) >= 2), typed: false, ctx: q.q, expected: q.correct.map((c) => q.options[c]).join(" / "), given: sel[i].map((c) => q.options[c]).join(" / ") });
    });
  } else if (type === "tf" && p.kind === "tf") {
    const sel = rec<string>(a.ans), tries = rec<number>(a.tries);
    p.items.forEach((it, i) => { if (!sel[i]) return; const ok = sel[i] === it.a; out.push({ key: String(i), idx: i, ok, firstOk: ok && !(Number(tries[i]) >= 2), typed: false, ctx: it.s, expected: it.a, given: sel[i] }); });
  } else if ((type === "transform" || type === "translate") && p.kind === "pairsArrow") {
    const val = rec<string>(a.val);
    p.items.forEach((it, i) => {
      if (!it.answers.length || !filled(val[i])) return;
      const ok = same(val[i], it.answers);
      out.push({ key: String(i), idx: i, ok, firstOk: first(String(i), ok, it.answers), typed: true, ctx: it.q, expected: it.answers.join(" / "), given: String(val[i]) });
    });
  } else if (type === "dictation" && p.kind === "lines") {
    const val = rec<string>(a.val);
    p.items.forEach((x, i) => { if (!filled(val[i])) return; const ok = dictationGrade(String(val[i]), x) === "exact"; out.push({ key: String(i), idx: i, ok, firstOk: first(String(i), ok), typed: true, ctx: "dictation", expected: x, given: String(val[i]) }); });
  } else {
    // остальные форматы: только верно / ошибка по пункту, без подробностей
    const st = progressOf({ id: "", type, content: task.content, options: task.options }, a) ?? [];
    st.forEach((s, i) => { if (s === "ok" || s === "bad") out.push({ key: String(i), idx: i, ok: s === "ok", firstOk: s === "ok", typed: false, ctx: "", expected: "", given: "" }); });
  }
  return out;
}

const tkey = (tg: TaskTags | undefined, item?: string) => {
  if (item) return item.startsWith("g-") || item.startsWith("v-") ? item : `n:${item.toLowerCase()}`;
  return tg?.topic ?? (tg?.topicName ? `n:${tg.topicName.toLowerCase()}` : "untagged");
};
const tname = (k: string, tg?: TaskTags) => (k.startsWith("n:") ? k.slice(2) : k === "untagged" ? "Без темы" : k === "other" ? "Другие ошибки" : topicLabel(k, tg?.topicName, "ru") || k);

/** Проверка сомнительных ответов ИИ (одним запросом). При сбое — «не проверено». */
async function verify(ctx: { userId: string; teacherId: string | null }, xs: Check[]) {
  if (!xs.length) return new Map<string, { verdict: Verdict; why: string }>();
  const clean = (raw: Record<string, unknown>) => {
    const items = Array.isArray(raw.items) ? raw.items as Record<string, unknown>[] : [];
    if (!items.length) throw new Error("verify: empty");
    return new Map(items.map((x) => [String(x.id), { verdict: (["correct", "topic_error", "other_error", "typo"].includes(String(x.verdict)) ? x.verdict : "unverified") as Verdict, why: String(x.why ?? "").slice(0, 200) }]));
  };
  try {
    const r = await runJson(llmFor("check", ctx), modelsFor("check"), prompt("lesson-verify"), { items: xs.slice(0, 40).map((c) => ({ id: c.id, instruction: c.title, topic: tname(c.topicKey), context: c.ctx, expected: c.expected, given: c.given })) }, clean, { tag: "lesson-verify", maxTokens: 3000, temperature: 0.1 });
    return r.data;
  } catch (e) { console.error("[lesson-verify]", (e as Error).message); return new Map(); }
}

/** Собрать (или пересобрать) итог урока по ученику. Прежние решения учителя и вердикты ИИ сохраняются. */
export async function buildLessonSummary(lessonInstanceId: string, studentId: string) {
  const l = await db.lessonInstance.findUnique({ where: { id: lessonInstanceId }, include: { homework: true } });
  if (!l?.templateId) return null;
  const tid = l.teacherId ?? (await db.student.findUnique({ where: { id: studentId }, select: { teacherId: true } }))?.teacherId;
  if (!tid) return null;
  const teacher = await db.user.findUnique({ where: { id: tid }, select: { id: true, name: true, lastName: true } });
  const ctx = { userId: tid, teacherId: tid, names: [teacher?.name, teacher?.lastName] };
  const answers = await db.answer.findMany({ where: { lessonInstanceId, studentId } });
  if (!answers.length) return null;
  // задания с ответами без метки — разметить (тихо: без меток итог всё равно соберётся, тема — «Без темы»)
  await tagTemplate(ctx, l.templateId, { only: answers.map((a) => a.taskId) }).catch((e) => console.error("[summary:tag]", (e as Error).message));
  const tasks = await db.task.findMany({ where: { id: { in: answers.map((a) => a.taskId) } } });
  const tById = new Map(tasks.map((t) => [t.id, t]));
  const prev = await db.lessonSummary.findUnique({ where: { lessonInstanceId_studentId: { lessonInstanceId, studentId } } });
  const prevChecks = new Map(((prev?.checks ?? []) as Check[]).map((c) => [c.id, c]));

  type Row = { taskId: string; type: string; title: string; tg?: TaskTags; ms: number; items: Item[] };
  const rows: Row[] = [];
  for (const a of answers) {
    const t = tById.get(a.taskId);
    if (!t) continue;
    const o = (t.options ?? {}) as TaskOptions;
    const items = itemsOf({ type: t.type, content: t.content, options: o }, (a.payload ?? {}) as P);
    if (items.length) rows.push({ taskId: t.id, type: t.type, title: t.title, tg: o.tags, ms: a.lessonMs + a.hwMs, items });
  }
  // сомнительные: неверно по ключу в заданиях со свободной формой
  const checks: Check[] = [];
  for (const r of rows) for (const it of r.items) {
    if (it.ok || !it.typed || !it.given) continue;
    const id = `${r.taskId}:${it.key}`;
    const p = prevChecks.get(id);
    checks.push(p && p.given === it.given ? p : { id, taskId: r.taskId, key: it.key, title: r.title, ctx: it.ctx, expected: it.expected, given: it.given, topicKey: tkey(r.tg, r.tg?.items?.[it.idx]), verdict: "unverified", why: "", status: "pending" });
  }
  const need = checks.filter((c) => c.verdict === "unverified");
  const v = await verify(ctx, need);
  for (const c of need) { const x = v.get(c.id); if (x) { c.verdict = x.verdict; c.why = x.why; } }
  // учителю на проверку — только то, что ИИ считает верным, и то, что не удалось проверить; ошибки по теме и прочие — сразу в итог
  for (const c of checks) if (c.status === "pending" && (c.verdict === "topic_error" || c.verdict === "other_error" || c.verdict === "typo")) c.status = "kept";
  const cBy = new Map(checks.map((c) => [c.id, c]));

  const stats = new Map<string, TopicStat & { w: number; wOk: number }>();
  let other = 0, typos = 0;
  const words = new Set<string>();
  for (const r of rows) {
    r.tg?.words?.forEach((w) => words.add(w));
    const w = FORMAT_WEIGHT[r.type] ?? 1;
    const seen = new Set<string>();
    for (const it of r.items) {
      const c = cBy.get(`${r.taskId}:${it.key}`);
      // не засчитываем то, что ждёт решения учителя, если ИИ считает ответ верным
      if (c?.status === "pending" && c.verdict === "correct") continue;
      let ok = it.ok, firstOk = it.firstOk, key = tkey(r.tg, r.tg?.items?.[it.idx]);
      if (c?.status === "accepted") { ok = true; firstOk = true; }
      else if (c?.verdict === "typo") { typos++; ok = true; firstOk = true; }
      else if (c?.verdict === "other_error" && c.status === "kept") { other++; key = "other"; }
      const s = stats.get(key) ?? { key, ...(key.startsWith("g-") || key.startsWith("v-") ? { topic: key } : {}), name: tname(key, r.tg), skill: r.tg?.skill, items: 0, firstOk: 0, ok: 0, score: 0, ms: 0, tasks: 0, w: 0, wOk: 0 };
      s.items++; if (firstOk) s.firstOk++; if (ok) s.ok++;
      s.w += w; if (firstOk) s.wOk += w;
      if (!seen.has(key)) { seen.add(key); s.tasks++; s.ms += r.ms; }
      stats.set(key, s);
    }
  }
  const topics: TopicStat[] = [...stats.values()].map(({ w, wOk, ...s }) => ({ ...s, score: w ? Math.round((wOk / w) * 100) : 0 })).sort((a, b) => a.score - b.score);
  // для учителя: самое трудное (больше ошибок с первой попытки) и самое долгое задание
  const hard = rows.map((r) => ({ r, wrong: r.items.filter((x) => !x.firstOk).length })).sort((a, b) => b.wrong - a.wrong)[0];
  const long = [...rows].sort((a, b) => b.ms - a.ms)[0];
  const lt = await db.lessonTemplate.findUnique({ where: { id: l.templateId }, select: { tasks: { where: { type: "wordset" }, select: { type: true, content: true } } } });
  lt?.tasks.forEach((t) => { const p = parse("wordset", t.content); if (p.kind === "wordset") p.items.forEach((x) => words.add(x.word)); });
  const pending = checks.filter((c) => c.status === "pending").length;
  const weak = topics.filter((x) => x.key !== "other" && x.key !== "untagged" && x.score < 75);
  const strong = topics.filter((x) => x.score >= 90 && x.items >= 3);
  const points = [
    weak.length ? `**Слабее всего:** ${weak.slice(0, 3).map((x) => `${x.name} (${x.score}%)`).join(", ")}` : "",
    strong.length ? `**Уверенно:** ${strong.slice(0, 3).map((x) => x.name).join(", ")}` : "",
    hard && hard.wrong ? `**Труднее всего:** «${hard.r.title.slice(0, 60)}» — ${hard.wrong} из ${hard.r.items.length} с ошибкой` : "",
    long && long.ms > 60000 ? `**Дольше всего:** «${long.title.slice(0, 60)}» — ${Math.round(long.ms / 60000)} мин` : "",
    pending ? `**Проверьте:** ${pending} ответ(ов) отмечены ошибкой, но ИИ считает их верными` : "",
  ].filter(Boolean);
  const notes: Notes = {
    ...(hard && hard.wrong ? { hardest: { taskId: hard.r.taskId, title: hard.r.title, wrong: hard.wrong, items: hard.r.items.length } } : {}),
    ...(long && long.ms ? { longest: { taskId: long.taskId, title: long.title, ms: long.ms } } : {}),
    words: [...words].slice(0, 80), points, other, typos,
  };
  const data = { topics: json(topics), checks: json(checks), notes: json(notes) };
  return db.lessonSummary.upsert({ where: { lessonInstanceId_studentId: { lessonInstanceId, studentId } }, create: { lessonInstanceId, studentId, ...data }, update: data });
}
