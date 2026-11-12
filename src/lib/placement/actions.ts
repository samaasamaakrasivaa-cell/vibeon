"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { randomToken, shortCode } from "../auth/crypto";
import { secureCookies } from "../env";
import { notify } from "../notify";
import { rateLimit } from "../rate-limit";
import { getLang } from "../i18n/server";
import { attemptFor, ptCookie } from "./access";
import { getBank, isOwner, TEEN_READY, trackOf, type Track } from "./bank";
import { checkCore, emptyState, EXPECT, pickTask, PL_LEVELS, stepIdx, summarize, words, type CoreItem, type Expect, type ListenItem, type ReadItem, type SpeakItem, type WriteItem } from "./engine";
import { addNextText, advance, closeSection, ensureTasks, enter, goTo, json, LATER, availOf, openOf, publicView, stateOf, type Later, type PView } from "./run";
import { revealedScripts } from "./review";

type R = { ok: true; id?: string; view?: PView } | { ok: false; error: string };
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function load(id: string) {
  const acc = await attemptFor(id);
  if (!acc || acc.who !== "taker") throw new Error("not found");
  if (acc.a.status === "submitted" || acc.a.status === "reviewed") throw new Error("done");
  return { ...acc, st: stateOf(acc.a.state) };
}
async function save(id: string, st: ReturnType<typeof stateOf>, extra: Record<string, unknown> = {}) {
  const view = publicView(st, await getLang(), (await getBank(trackOf(st.track))).bank); // считает и полоску прогресса — до записи
  await db.placementAttempt.update({ where: { id }, data: { state: json(st), ...extra } });
  return { ok: true as const, view };
}
const wrap = async (fn: () => Promise<R>): Promise<R> => {
  try { return await fn(); } catch (e) {
    if (!(e instanceof Error && (e.message === "done" || e.message === "not found"))) console.error("[placement]", e instanceof Error ? e.stack : e);
    return { ok: false, error: e instanceof Error && e.message === "done" ? "done" : "not found" };
  }
};

// ───────── Прохождение ─────────

/** Вводный экран пройден (микрофон и звук проверены) — начинаем ядро. */
export async function startPlacement(id: string): Promise<R> {
  return wrap(async () => {
    const { a, st } = await load(id);
    const { bank } = await getBank(trackOf(st.track));
    if (!st.core) Object.assign(st, emptyState());
    if (st.section === "intro") { st.section = "core"; enter(st, "core"); }
    advance(st, bank);
    if (a.checkpointId) await db.checkpoint.update({ where: { id: a.checkpointId }, data: { status: "assigned" } }).catch(() => null);
    return save(id, st, { status: "active", startedAt: a.startedAt ?? new Date() });
  });
}

/** Какие варианты ученик выбирал до итогового ответа: индексы вариантов, -1 — «Не знаю». Повторы подряд и итоговый — убираем. */
function trail(x: unknown, n: number, final: string | number | null): number[] {
  if (!Array.isArray(x)) return [];
  const out: number[] = [];
  for (const k of x.slice(0, 30)) if (Number.isInteger(k) && k >= -1 && k < n && out[out.length - 1] !== k) out.push(k as number);
  while (out.length && out[out.length - 1] === (final === null ? -1 : final)) out.pop();
  return out.slice(-10);
}

/** dk — «Не знаю»: засчитывается как неверный ответ, но в разборе отмечен отдельно. */
export async function answerCore(id: string, itemId: string, v: string | number | null, ms: number, dk = false, hinted = false, tried: unknown = []): Promise<R> {
  return wrap(async () => {
    const { st } = await load(id);
    const last = st.core[st.core.length - 1];
    if ((st.section !== "core" && st.section !== "vocab") || !last || last.id !== itemId || st.answers[itemId]) return { ok: true, view: publicView(st, await getLang()) };
    const it = st.items[itemId] as CoreItem;
    const val = dk ? null : typeof v === "number" ? v : str(v, 120);
    const tr = trail(tried, it.options?.length ?? 0, val);
    st.answers[itemId] = { v: val, ok: dk ? false : checkCore(it, val), ms: Math.max(0, Math.min(3600e3, Math.round(ms) || 0)), ...(dk ? { dk: true } : {}), ...(hinted ? { h: true } : {}), ...(tr.length ? { tr } : {}) };
    advance(st, (await getBank(trackOf(st.track))).bank);
    return save(id, st);
  });
}

/** Черновик ответа на вопрос к тексту или записи (-1 — «Не знаю»). Можно менять до «Завершить раздел». */
export async function draftText(id: string, qid: string, v: number): Promise<R> {
  return wrap(async () => {
    const { st } = await load(id);
    if (st.section !== "reading" && st.section !== "listening") return { ok: false, error: "section" };
    const ids = st.section === "reading" ? st.reading : st.listening;
    const done = st.section === "reading" ? st.rdone : st.ldone;
    const it = ids.filter((x) => !done.includes(x)).map((x) => st.items[x] as ReadItem | ListenItem).find((x) => x.questions.some((q) => q.id === qid));
    const q = it?.questions.find((x) => x.id === qid);
    if (!q || !Number.isInteger(v) || v < -1 || v >= q.options.length) return { ok: false, error: "q" };
    const prev = st.open?.[qid];
    if (typeof prev === "number" && prev !== v) st.openTr = { ...(st.openTr ?? {}), [qid]: [...(st.openTr?.[qid] ?? []), prev].slice(-10) };
    st.open = { ...(st.open ?? {}), [qid]: v };
    await db.placementAttempt.update({ where: { id }, data: { state: json(st) } });
    return { ok: true };
  });
}

/** «Завершить раздел» чтения или аудирования: ответы засчитываются, вернуться к ним нельзя. */
export async function finishTexts(id: string): Promise<R> {
  return wrap(async () => {
    const l = await load(id); const { st } = l; const acc = () => l;
    if (st.section !== "reading" && st.section !== "listening") return { ok: true, view: publicView(st, await getLang()) };
    const ids = st.section === "reading" ? st.reading : st.listening;
    const done = st.section === "reading" ? st.rdone : st.ldone;
    for (const tid of ids.filter((x) => !done.includes(x))) {
      const it = st.items[tid] as ReadItem | ListenItem;
      for (const q of it.questions) {
        const v = st.open?.[q.id];
        const n = typeof v === "number" && v >= 0 && v < q.options.length ? v : null;
        const tr = (st.openTr?.[q.id] ?? []).filter((x) => x !== v);
        st.answers[q.id] = { v: n, ok: n === q.answer, ...(v === -1 ? { dk: true } : {}), ...(tr.length ? { tr } : {}) };
      }
      done.push(tid);
    }
    const { bank } = await getBank(trackOf(st.track));
    if (addNextText(st, bank, st.section)) return save(id, st); // следующий текст — по результату предыдущего
    return closeAndGo(acc(), st, st.section);
  });
}

/** Ученик открыл текст вопроса говорения (по умолчанию вопрос только на слух) — учителю это видно. */
export async function peekSpeak(id: string, n: number): Promise<R> {
  return wrap(async () => {
    const { st } = await load(id);
    const sp = st.speaking ? (st.items[st.speaking.id] as { questions?: unknown[] } | undefined) : undefined;
    if (!sp?.questions || !Number.isInteger(n) || n < 1 || n > sp.questions.length) return { ok: false, error: "q" };
    if (!(st.peek ?? []).includes(String(n))) st.peek = [...(st.peek ?? []), String(n)];
    await db.placementAttempt.update({ where: { id }, data: { state: json(st) } });
    return { ok: true };
  });
}

/** Запись можно прослушать не больше двух раз — счётчик хранится на сервере. */
export async function notePlay(id: string, itemId: string): Promise<R> {
  return wrap(async () => {
    const { st } = await load(id);
    const it = st.items[itemId] as ListenItem | undefined;
    if (!it || it.type !== "listening") return { ok: false, error: "item" };
    const used = st.plays[itemId] ?? 0;
    if (used >= (it.plays ?? 2)) return { ok: false, error: "plays" };
    st.plays[itemId] = used + 1;
    return save(id, st);
  });
}

/** Черновик письма сохраняется по ходу; final — переход к говорению. */
export async function saveWriting(id: string, text: string, final: boolean): Promise<R> {
  return wrap(async () => {
    const l = await load(id); const { st } = l;
    if (st.section !== "writing") return { ok: true, view: publicView(st, await getLang()) };
    st.writing = { id: st.writing?.id ?? "", text: str(text, 8000) };
    if (final) {
      if (words(st.writing.text) < 3) return { ok: false, error: "empty" };
      return closeAndGo(l, st, "writing");
    }
    return save(id, st);
  });
}

/** Говорение записано (или микрофон не работает) — раздел закрывается; если это последний раздел, тест уходит учителю. */
export async function finishPlacement(id: string, noMic = false): Promise<R> {
  return wrap(async () => {
    const l = await load(id); const { st } = l;
    if (st.section !== "speaking") return { ok: false, error: "section" };
    const sp = st.speaking ? (st.items[st.speaking.id] as SpeakItem) : null;
    const recorded = Object.keys(st.speaking?.rec ?? {}).length;
    if (sp && recorded < sp.questions.length && !noMic) return { ok: false, error: "rec" };
    if (noMic && st.speaking) (st.speaking as { noMic?: boolean }).noMic = true;
    return closeAndGo(l, st, "speaking");
  });
}

/** Перейти к другому незавершённому разделу (после ядра). */
export async function goSection(id: string, sec: string): Promise<R> {
  return wrap(async () => {
    const { st } = await load(id);
    if (!(LATER as readonly string[]).includes(sec) || !availOf(st).includes(sec as Later) || st.section === "core" || st.section === "vocab" || st.section === "intro") return { ok: false, error: "section" };
    ensureTasks(st, (await getBank(trackOf(st.track))).bank); // старые прохождения: задание раздела могло ещё не быть выбрано
    goTo(st, sec as Later);
    return save(id, st);
  });
}

type Loaded = Awaited<ReturnType<typeof load>>;
async function closeAndGo(l: Loaded, st: Loaded["st"], sec: Later): Promise<R> {
  const { bank } = await getBank(trackOf(st.track));
  if (!closeSection(st, sec, bank)) return save(l.a.id, st);
  const { a } = l;
  st.section = "done";
  const extra = sec === "writing" || sec === "speaking" ? st.wsExtra?.[sec] : undefined; // ответ на дополнительное задание
  const r = await save(a.id, st, { status: "submitted", submittedAt: new Date() });
  // точка А, уже выставленная по первому заданию, остаётся в маршруте — учитель при желании уточнит итог
  const cp = a.checkpointId ? await db.checkpoint.findUnique({ where: { id: a.checkpointId }, select: { status: true } }) : null;
  if (a.checkpointId && !(extra && cp?.status === "done")) await db.checkpoint.update({ where: { id: a.checkpointId }, data: { status: "review", takenAt: new Date() } }).catch(() => null);
  if (a.mode !== "self") {
    const who = a.mode === "student" ? `${a.student?.name ?? ""} ${a.student?.lastName ?? ""}`.trim() : a.guestName ?? "";
    const title = extra ? `${who}: дополнительное задание по ${sec === "writing" ? "письму" : "говорению"} выполнено — проверьте` : `${who}: placement test пройден — проверьте письмо и говорение`;
    await notify({ userId: a.teacherId, kind: "test", title, action: "review", link: `/teacher/placement/${a.id}` });
  }
  revalidatePath("/teacher/courses");
  if (a.studentId) revalidatePath(`/teacher/students/${a.studentId}`);
  return r;
}

// ───────── Назад в грамматике и лексике (опечатка, передумал) ─────────

/** Посмотреть уже отвеченное задание ядра (idx с нуля) — с ответом ученика, без правильного. */
export async function peekCore(id: string, idx: number): Promise<R & { item?: unknown; given?: string | number | null; dk?: boolean }> {
  try {
    const { st } = await load(id);
    const x = st.core[idx];
    const inBlock = (y?: { ph?: string }) => !!y && (st.section === "vocab" ? !!y.ph?.startsWith("v") : st.section === "core" && !y.ph?.startsWith("v"));
    if (!inBlock(x) || !st.answers[x.id]) return { ok: false, error: "idx" };
    const it = st.items[x.id] as CoreItem;
    const ins = (await import("./bank")).instruction(it.type, it.level, trackOf(st.track));
    return { ok: true, item: { id: it.id, type: it.type, skill: it.skill, q: it.q, options: it.options ?? null, base: it.base ?? null, key: it.key ?? null, frame: it.frame ?? null, hint: (it as CoreItem & { hint_ru?: string }).hint_ru ?? null, instr: ins }, given: st.answers[x.id].v, dk: !!st.answers[x.id].dk };
  } catch { return { ok: false, error: "not found" }; }
}
/** Исправить ответ на уже пройденное задание ядра (пока раздел не закончен). */
export async function reviseCore(id: string, itemId: string, v: string | number | null, dk = false): Promise<R> {
  return wrap(async () => {
    const { st } = await load(id);
    const x = st.core.find((y) => y.id === itemId);
    const inBlock = !!x && (st.section === "vocab" ? !!x.ph?.startsWith("v") : st.section === "core" && !x.ph?.startsWith("v"));
    if (!inBlock || !st.answers[itemId]) return { ok: false, error: "idx" };
    const it = st.items[itemId] as CoreItem;
    const val = dk ? null : typeof v === "number" ? v : str(v, 120);
    const old = st.answers[itemId];
    const tr = [...(old.tr ?? []), ...(old.dk ? [-1] : old.v !== null && old.v !== val ? [old.v] : [])].slice(-10);
    st.answers[itemId] = { ...old, v: val, ok: dk ? false : checkCore(it, val), dk: dk || undefined, ...(tr.length ? { tr } : {}) };
    return save(id, st);
  });
}

// ───────── Ссылка для нового человека ─────────

/** Новый человек вводит имя и контакт — создаётся прохождение, доступ к нему — по куке в этом браузере. */
export async function startGuest(code: string, name: string, contact: string, consent: boolean): Promise<R> {
  if (!(await rateLimit("pl-guest", 10, 600))) return { ok: false, error: "rate" };
  const link = await db.placementLink.findUnique({ where: { code } });
  if (!link || !link.active) return { ok: false, error: "link" };
  const n = str(name, 80), c = str(contact, 120);
  if (!n) return { ok: false, error: "name" };
  if (!c) return { ok: false, error: "contact" };
  if (!consent) return { ok: false, error: "consent" };
  const token = randomToken(24);
  const a = await db.placementAttempt.create({ data: { teacherId: link.teacherId, linkId: link.id, mode: "link", guestName: n, guestContact: c, token, track: trackOf(link.track), state: json(emptyState(null, trackOf(link.track))) } });
  (await cookies()).set(ptCookie(a.id), token, { httpOnly: true, secure: secureCookies, sameSite: "lax", path: "/", maxAge: 60 * 24 * 3600 });
  return { ok: true, id: a.id };
}

// ───────── Учитель ─────────

async function teacherAttempt(id: string) {
  const me = await requireUser("TEACHER");
  const a = await db.placementAttempt.findUnique({ where: { id }, include: { student: true } });
  if (!a || a.teacherId !== me.id) throw new Error("not found");
  return { me, a };
}
const refreshT = (studentId?: string | null) => {
  revalidatePath("/teacher/courses");
  if (studentId) { revalidatePath(`/teacher/students/${studentId}`); revalidatePath("/student/route"); revalidatePath("/student"); }
};

/** «Пройти самой»: учитель проходит тест как ученик, результат видит сразу. */
/** Пройти тест самому. fresh — начать заново: незаконченный свой тест удаляется; иначе продолжаем незаконченный. */
export async function selfPlacement(fresh = false, trackIn?: Track): Promise<R> {
  const me = await requireUser("TEACHER");
  const track = teenOk(trackIn, me.email);
  const unfinished = { teacherId: me.id, mode: "self", track, status: { in: ["new", "active"] } };
  if (fresh) await db.placementAttempt.deleteMany({ where: unfinished });
  else {
    const open = await db.placementAttempt.findFirst({ where: unfinished, orderBy: { createdAt: "desc" } });
    if (open) return { ok: true, id: open.id };
  }
  const a = await db.placementAttempt.create({ data: { teacherId: me.id, mode: "self", track, token: randomToken(24), state: json(withSeen(emptyState(null, track), await seenBy({ teacherId: me.id, mode: "self", track }))) } });
  return { ok: true, id: a.id };
}

/** Назначить вводный тест ученику (из «Курсы → Тесты» или из анкеты). Старый незавершённый тест заменяется. */
/** Задания из прошлых прохождений — при новом тесте их берём в последнюю очередь. */
async function seenBy(where: { studentId?: string; teacherId?: string; mode?: string; track?: string }) {
  const prev = await db.placementAttempt.findMany({ where, select: { state: true }, orderBy: { createdAt: "desc" }, take: 5 });
  type S = { core?: { id: string }[]; writing?: { id?: string }; speaking?: { id?: string }; wsPrev?: { id?: string }[] };
  return [...new Set(prev.flatMap((p) => { const s = (p.state ?? {}) as S; return [...(s.core ?? []).map((x) => x.id), s.writing?.id, s.speaking?.id, ...(s.wsPrev ?? []).map((x) => x.id)].filter((x): x is string => !!x); }))];
}
const withSeen = (st: ReturnType<typeof emptyState>, seen: string[]) => (seen.length ? { ...st, seen } : st);

/** Teens доступна всем, когда банк готов; до этого — только владельцу платформы (для проверки). */
const teenOk = (t: Track | undefined, email?: string | null): Track => (t === "teen" && (TEEN_READY || isOwner(email)) ? "teen" : "adult");
const expectOf = (e?: string | null) => (e && e in EXPECT ? (e as Expect) : null);

export async function assignPlacement(studentId: string, expected?: string | null, trackIn?: Track): Promise<R> {
  const me = await requireUser("TEACHER");
  const track = teenOk(trackIn, me.email);
  const s = await db.student.findUnique({ where: { id: studentId } });
  if (!s || s.teacherId !== me.id) return { ok: false, error: "not found" };
  const old = await db.checkpoint.findMany({ where: { studentId, kind: "entry", status: "assigned" }, select: { id: true } });
  if (old.length) {
    await db.placementAttempt.deleteMany({ where: { checkpointId: { in: old.map((x) => x.id) }, status: { in: ["new", "active"] } } });
    await db.checkpoint.deleteMany({ where: { id: { in: old.map((x) => x.id) } } });
  }
  const r = await db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } });
  const c = await db.checkpoint.create({ data: { studentId, roadmapId: r?.id ?? null, kind: "entry", source: "placement" } });
  const seen = await seenBy({ studentId, track });
  await db.placementAttempt.create({ data: { teacherId: me.id, studentId, checkpointId: c.id, mode: "student", track, token: randomToken(24), state: json(withSeen(emptyState(expectOf(expected), track), seen)) } });
  if (s.userId) await notify({ userId: s.userId, kind: "test", title: track === "teen" ? "Учитель назначил тебе Placement test Teens — нажми, чтобы начать" : "Преподаватель назначил вам placement test — можно начинать", action: "take", link: `/student/test/${c.id}` });
  refreshT(studentId);
  return { ok: true, id: c.id };
}

export async function createPlacementLink(showResult: boolean, trackIn?: Track): Promise<R> {
  const me = await requireUser("TEACHER");
  const track = teenOk(trackIn, me.email);
  const code = shortCode(10).toLowerCase();
  // у каждой версии — своя действующая ссылка
  await db.placementLink.updateMany({ where: { teacherId: me.id, active: true, track }, data: { active: false } });
  const l = await db.placementLink.create({ data: { teacherId: me.id, code, showResult: !!showResult, track } });
  refreshT();
  return { ok: true, id: l.code };
}
export async function setLinkShowResult(code: string, on: boolean): Promise<R> {
  const me = await requireUser("TEACHER");
  await db.placementLink.updateMany({ where: { code, teacherId: me.id }, data: { showResult: !!on } });
  refreshT();
  return { ok: true };
}
export async function closePlacementLink(code: string): Promise<R> {
  const me = await requireUser("TEACHER");
  await db.placementLink.updateMany({ where: { code, teacherId: me.id }, data: { active: false } });
  refreshT();
  return { ok: true };
}

export type ReviewInput = { writing: Record<string, number>; speaking: Record<string, number>; points: boolean[]; comment: string; lesson?: { level: string; marks: Record<string, number> } | null };
const cleanScores = (m: Record<string, number> | undefined) => Object.fromEntries(Object.entries(m ?? {}).filter(([k, v]) => /^[a-z]{2,20}$/.test(k) && Number.isInteger(v) && v >= 0 && v <= 3));

/** Баллы 0–3 по критериям письма и говорения, пункты задания письма, комментарий (сохраняются по ходу проверки). */
export async function saveReview(id: string, r: ReviewInput): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    const prev = (a.review ?? {}) as Record<string, unknown>;
    const points = Array.isArray(r.points) ? r.points.slice(0, 10).map(Boolean) : [];
    const lesson = r.lesson && PL_LEVELS.includes(r.lesson.level as never) ? { level: r.lesson.level, marks: cleanScores(r.lesson.marks) } : r.lesson === null ? null : prev.lesson;
    await db.placementAttempt.update({ where: { id }, data: { review: json({ ...prev, writing: cleanScores(r.writing), speaking: cleanScores(r.speaking), points, comment: str(r.comment, 3000), lesson }) } });
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

/** Итог выбирает учитель. Для ученика он становится точкой A маршрута. */
export async function finalizePlacement(id: string, level: string): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    if (stepIdx(level) < 0) return { ok: false, error: "level" };
    if (a.status !== "submitted" && a.status !== "reviewed") return { ok: false, error: "status" };
    await db.placementAttempt.update({ where: { id }, data: { level, status: "reviewed", reviewedAt: new Date() } });
    if (a.checkpointId && a.studentId) {
      const st = stateOf(a.state);
      const { bank } = await getBank(trackOf(st.track));
      const sm = summarize(st, bank);
      const pct = (rows: [number, number][]) => { const t = rows.reduce((x, r) => [x[0] + r[0], x[1] + r[1]], [0, 0]); return t[1] ? Math.round((t[0] / t[1]) * 100) : undefined; };
      const skills = {
        grammar: pct(Object.values(sm.core).map((r) => r.grammar)), vocabulary: pct(Object.values(sm.core).map((r) => r.vocabulary)),
        reading: sm.level && sm.reading[sm.level] ? pct([sm.reading[sm.level]]) : undefined, listening: sm.level && sm.listening[sm.level] ? pct([sm.listening[sm.level]]) : undefined,
      };
      const wrong = st.core.map((x) => st.items[x.id] as CoreItem).filter((it) => it && !st.answers[it.id]?.ok);
      const right = st.core.map((x) => st.items[x.id] as CoreItem).filter((it) => it && st.answers[it.id]?.ok && it.level !== "A1");
      const uniq = (xs: CoreItem[]) => [...new Map(xs.map((x) => [x.topic_id, [x.topic_en, x.topic_ru]])).values()];
      await db.checkpoint.update({
        where: { id: a.checkpointId },
        data: { status: "done", level, takenAt: a.submittedAt ?? new Date(), results: json({ skills: Object.fromEntries(Object.entries(skills).filter(([, v]) => v !== undefined)), weak: uniq(wrong).slice(0, 8), strong: uniq(right).slice(0, 4), placement: id, shown: a.showResult }) },
      });
      await db.student.update({ where: { id: a.studentId }, data: { level } });
    }
    refreshT(a.studentId);
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

/** «Показать результат ученику». */
export async function setShowResult(id: string, on: boolean): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    await db.placementAttempt.update({ where: { id }, data: { showResult: !!on } });
    if (a.checkpointId) {
      const c = await db.checkpoint.findUnique({ where: { id: a.checkpointId } });
      if (c) await db.checkpoint.update({ where: { id: c.id }, data: { results: json({ ...((c.results ?? {}) as object), shown: !!on }) } });
    }
    if (on && a.student?.userId) await notify({ userId: a.student.userId, kind: "test", title: "Готов результат placement test", action: "review", link: `/student/test/${a.checkpointId}`, dedupe: `pl-shown:${id}` });
    refreshT(a.studentId);
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

/** «Глазик» на разборе: учитель открывает ученику скрипт записи. */
export async function toggleReveal(id: string, itemId: string): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    if (!stateOf(a.state).items[itemId]) return { ok: false, error: "item" };
    const reveal = a.reveal.includes(itemId) ? a.reveal.filter((x) => x !== itemId) : [...a.reveal, itemId];
    await db.placementAttempt.update({ where: { id }, data: { reveal } });
    return { ok: true };
  });
}

export async function deletePlacement(id: string): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    await db.placementAttempt.delete({ where: { id } });
    if (a.checkpointId && a.status !== "reviewed") await db.checkpoint.deleteMany({ where: { id: a.checkpointId } });
    refreshT(a.studentId);
    return { ok: true };
  });
}

/** Ученик на разборе: скрипты, которые открыл учитель (опрос раз в несколько секунд). */
export async function revealState(id: string): Promise<Record<string, string>> {
  const acc = await attemptFor(id);
  if (!acc || !(acc.a.showResult || acc.who === "teacher")) return {};
  return revealedScripts(stateOf(acc.a.state), acc.a.reveal);
}

/** Дополнительное задание письма или говорения уровнем выше (dir = 1) или ниже (-1). Одно на навык; в итог идёт последний ответ,
 *  прошлый остаётся в разборе. Ученику открывается только этот раздел. */
export async function assignExtraWS(id: string, kind: "writing" | "speaking", dir: number): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    if (a.status !== "submitted" && a.status !== "reviewed") return { ok: false, error: "status" };
    const st = stateOf(a.state);
    if (st.wsExtra?.[kind]) return { ok: false, error: "once" };
    const cur = kind === "writing" ? st.writing : st.speaking;
    if (!cur) return { ok: false, error: "task" };
    const it = st.items[cur.id] as WriteItem | SpeakItem;
    const li = PL_LEVELS.indexOf(it.level) + (dir > 0 ? 1 : -1);
    if (li < 0 || li > 4) return { ok: false, error: "edge" };
    const { bank } = await getBank(trackOf(st.track));
    const used = [cur.id, ...(st.wsPrev ?? []).map((x) => x.id)];
    const nx = kind === "writing" ? pickTask(bank.writing, PL_LEVELS[li], false, Math.random, used) : pickTask(bank.speaking, PL_LEVELS[li], false, Math.random, used);
    if (!nx) return { ok: false, error: "task" };
    const review = (a.review ?? {}) as Record<string, unknown>;
    st.wsPrev = [...(st.wsPrev ?? []), kind === "writing"
      ? { kind, id: cur.id, text: (cur as { text: string }).text, marks: review.writing as Record<string, number>, points: review.points as boolean[] }
      : { kind, id: cur.id, rec: (cur as { rec: Record<string, string> }).rec, rerec: st.rerec, peek: st.peek, marks: review.speaking as Record<string, number> }];
    st.items[nx.id] = nx;
    if (kind === "writing") st.writing = { id: nx.id, text: "" };
    else { st.speaking = { id: nx.id, rec: {} }; st.rerec = {}; st.peek = undefined; (st.speaking as { noMic?: boolean }).noMic = undefined; }
    st.wsExtra = { ...(st.wsExtra ?? {}), [kind]: dir > 0 ? 1 : -1 };
    st.closed = LATER.filter((x) => x !== kind);
    st.section = kind; enter(st, kind);
    const nextReview = { ...review, [kind]: {}, ...(kind === "writing" ? { points: [] } : {}) };
    await db.placementAttempt.update({ where: { id }, data: { state: json(st), review: json(nextReview), status: "active" } });
    if (a.mode === "student" && a.student?.userId)
      await notify({ userId: a.student.userId, kind: "test", title: kind === "writing" ? "Преподаватель дал дополнительное задание по письму" : "Преподаватель дал дополнительное задание по говорению", action: "decide", link: a.checkpointId ? `/student/test/${a.checkpointId}` : `/placement/${id}` });
    refreshT(a.studentId);
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

/** Вопросы для урока (говорение уровнем выше/ниже) — дописать в заметку ближайшего урока ученика. */
export async function addSpeakingToLesson(id: string, level: string, questions: string[]): Promise<R & { when?: string }> {
  return wrap(async () => {
    const { me, a } = await teacherAttempt(id);
    if (!a.studentId) return { ok: false, error: "nostudent" };
    const l = await db.lessonInstance.findFirst({ where: { studentId: a.studentId, status: "PLANNED", startsAt: { gte: new Date(Date.now() - 3600e3) } }, orderBy: { startsAt: "asc" } });
    if (!l) return { ok: false, error: "nolesson" };
    void me;
    const block = [`Placement test — говорение ${str(level, 4)}:`, ...questions.slice(0, 8).map((q, i) => `${i + 1}. ${str(q, 300)}`)].join("\n");
    await db.lessonInstance.update({ where: { id: l.id }, data: { note: l.note ? `${l.note}\n\n${block}` : block } });
    return { ok: true, when: l.startsAt.toISOString() };
  });
}
