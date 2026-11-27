"use server";
import { revalidatePath } from "next/cache";
import { wsPercent } from "../roadmap/pack";
import { cookies } from "next/headers";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { randomToken, shortCode } from "../auth/crypto";
import { env, secureCookies } from "../env";
import { tgEnabled, tgSend } from "../notify/telegram";
import { notify } from "../notify";
import { rateLimit } from "../rate-limit";
import { getLang } from "../i18n/server";
import { attemptFor, ptCookie } from "./access";
import { coreInstruction, getBank, isOwner, TEEN_READY, trackOf, type Track } from "./bank";
import { describe5, RUB_V2, rubricOf } from "./rubric";
import { checkCore, typoOk, emptyState, EXPECT, pickTask, PlacementCoverageError, PL_LEVELS, SECTIONS, STEPS, stepIdx, type Section, summarize, words, type CoreItem, type Expect, type ListenItem, type ReadItem, type SpeakItem, type WriteItem } from "./engine";
import { addNextText, advance, begin, closeSection, doneOf, ensureTasks, enter, goTo, json, LATER, availOf, openOf, partsOf, publicView, stateOf, touch, type Later, type PView } from "./run";
import { teacherReview, missingReassessment } from "./teacher-review";
import { applyScore } from "./ai-feedback";
import { speechSource } from "./speech-transcript";
import { revealedScripts } from "./review";
import { R_BLOCKS, type RCfg, type RSaved, type RVariant } from "./report";
import { run } from "../ai/gateway";
import { provider } from "../ai/providers";
import { aiCode, aiCtx } from "../ai/ctx";
import type { PlScore } from "../ai/tasks";

type R = { ok: true; id?: string; view?: PView } | { ok: false; error: string };
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function load(id: string) {
  const acc = await attemptFor(id);
  if (!acc || acc.who !== "taker") throw new Error("not found");
  if (acc.a.status === "submitted" || acc.a.status === "reviewed") throw new Error("done");
  return { ...acc, st: stateOf(acc.a.state) };
}
async function save(id: string, st: ReturnType<typeof stateOf>, extra: Record<string, unknown> = {}) {
  touch(st);
  const view = publicView(st, await getLang(), (await getBank(trackOf(st.track))).bank); // считает и полоску прогресса — до записи
  await db.placementAttempt.update({ where: { id }, data: { state: json(st), ...extra } });
  return { ok: true as const, view };
}
const wrap = async (fn: () => Promise<R>): Promise<R> => {
  try { return await fn(); } catch (e) {
    if (!(e instanceof Error && (e.message === "done" || e.message === "not found"))) console.error("[placement]", e instanceof Error ? e.stack : e);
    if (e instanceof PlacementCoverageError) return { ok: false, error: "coverage" };
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
    // взрослый тест, назначенный до v6 и ещё не начатый: проходит уже по v6 (разминки нет, старт — ожидаемый уровень или B1)
    if (st.section === "intro" && st.track !== "teen" && !st.v6 && st.core.length === 0) {
      st.v6 = true; delete st.warm;
      if (st.start === undefined) st.start = emptyState().start;
    }
    const fin = st.section === "intro" ? begin(st, bank) : advance(st, bank);
    if (fin) return submit(await load(id), st);
    // добавленные разделы: точка А с уровнем остаётся в маршруте
    if (a.checkpointId && !st.added) await db.checkpoint.update({ where: { id: a.checkpointId }, data: { status: "assigned" } }).catch(() => null);
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
export async function answerCore(id: string, itemId: string, v: string | number | null, ms: number, dk = false, hinted = false, tried: unknown = [], sure?: boolean | null): Promise<R> {
  return wrap(async () => {
    const { st } = await load(id);
    const last = st.core[st.core.length - 1];
    if ((st.section !== "core" && st.section !== "vocab") || !last || last.id !== itemId || st.answers[itemId]) return { ok: true, view: publicView(st, await getLang()) };
    const it = st.items[itemId] as CoreItem;
    const val = dk ? null : typeof v === "number" ? v : str(v, 120);
    const tr = trail(tried, it.options?.length ?? 0, val);
    const ok = dk ? false : checkCore(it, val);
    // опечатка в слове при верной форме — засчитываем (только «вписать самому»), отмечаем для учителя
    const typo = !ok && !dk && typeof val === "string" && it.type !== "mcq" && it.type !== "fix" && it.skill === "grammar" && typoOk(val, it.accept ?? []);
    const ph = st.core[st.core.length - 1]?.ph;
    st.answers[itemId] = { v: val, ok: ok || typo, ms: Math.max(0, Math.min(3600e3, Math.round(ms) || 0)), ...(dk ? { dk: true } : {}), ...(hinted ? { h: true } : {}), ...(tr.length ? { tr } : {}),
      ...(typo ? { ty: true } : {}), ...(!dk && typeof sure === "boolean" && (ph === "t" || ph === "c" || ph === "g") ? { cf: (sure ? 1 : 0) as 0 | 1 } : {}) };
    if (advance(st, (await getBank(trackOf(st.track))).bank)) return submit(await load(id).then((l) => ({ ...l, st })), st);
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
    touch(st);
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
    if (st.xt?.kind === st.section) { st.xdone = st.xt.kind; st.xt = undefined; } // дополнительный текст учителя — без следующего
    else if (addNextText(st, bank, st.section)) return save(id, st); // следующий текст — по результату предыдущего
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
  return submit(l, st, sec);
}

/** Разделов больше нет — тест уходит учителю. */
async function submit(l: Loaded, st: Loaded["st"], sec?: Later): Promise<R> {
  const { a } = l;
  st.section = "done";
  const extra = sec === "writing" || sec === "speaking" ? st.wsExtra?.[sec] : undefined; // ответ на дополнительное задание
  const xdone = st.xdone; st.xdone = undefined; // дополнительное задание другого уровня (грамматика, лексика, чтение, аудирование)
  const r = await save(a.id, st, { status: "submitted", submittedAt: new Date() });
  // точка А, уже выставленная по первому заданию, остаётся в маршруте — учитель при желании уточнит итог
  const cp = a.checkpointId ? await db.checkpoint.findUnique({ where: { id: a.checkpointId }, select: { status: true } }) : null;
  if (a.checkpointId && !((extra || xdone || st.added) && cp?.status === "done")) await db.checkpoint.update({ where: { id: a.checkpointId }, data: { status: "review", takenAt: new Date() } }).catch(() => null);
  if (a.mode !== "self") {
    const who = a.mode === "student" ? `${a.student?.name ?? ""} ${a.student?.lastName ?? ""}`.trim() : a.guestName ?? "";
    const parts = partsOf(st);
    const XN: Record<string, string> = { core: "грамматике", vocab: "лексике", reading: "чтению", listening: "аудированию" };
    const title = xdone ? `${who}: дополнительное задание по ${XN[xdone] ?? xdone} выполнено — проверьте`
      : extra ? `${who}: дополнительное задание по ${sec === "writing" ? "письму" : "говорению"} выполнено — проверьте`
      : st.added ? `${who}: добавленные разделы placement test пройдены — проверьте`
      : parts.includes("writing") || parts.includes("speaking") ? `${who}: placement test пройден — проверьте письмо и говорение` : `${who}: placement test пройден — посмотрите результат`;
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
    const ins = coreInstruction(it, trackOf(st.track));
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
    // Повторное сохранение без правки не применяет новую проверку к исторической оценке.
    if (it.type === "fix" && old.v === val && !!old.dk === dk) return { ok: true };
    const tr = [...(old.tr ?? []), ...(old.dk ? [-1] : old.v !== null && old.v !== val ? [old.v] : [])].slice(-10);
    const ok = dk ? false : checkCore(it, val);
    const typo = !ok && !dk && typeof val === "string" && it.type !== "mcq" && it.type !== "fix" && it.skill === "grammar" && typoOk(val, it.accept ?? []);
    st.answers[itemId] = { ...old, v: val, ok: ok || typo, ty: typo || undefined, dk: dk || undefined, ...(tr.length ? { tr } : {}) };
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
// Не позволяем открытой ранее вкладке перезаписать новую версию проверки.
const revision = (a: { id: string; updatedAt: Date; review: unknown; status: string; showResult: boolean }) =>
  ({ id: a.id, updatedAt: a.updatedAt, review: { equals: json(a.review) }, status: a.status, showResult: a.showResult });
const changed = { ok: false as const, error: "Проверка изменилась. Обновите страницу и повторите действие." };
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

/** Ступень грамматики из последнего пройденного теста ученика, где была грамматика. */
async function lastGrammar(studentId: string) {
  const xs = await db.placementAttempt.findMany({ where: { studentId, status: { in: ["submitted", "reviewed"] } }, orderBy: { createdAt: "desc" }, select: { id: true, state: true, submittedAt: true, createdAt: true, track: true, status: true } });
  for (const x of xs) {
    const st = stateOf(x.state);
    if (typeof st.step === "number" && partsOf(st).includes("core") && doneOf(st).includes("core"))
      return { step: st.step, sub: STEPS[Math.max(0, Math.min(8, st.step))], at: new Date(st.sdates?.core ?? (x.submittedAt ?? x.createdAt).getTime()) };
  }
  return null;
}

export type PlInfo = {
  grammar: { sub: string; when: string } | null;
  last: { id: string; when: string; status: string; done: string[]; parts: string[]; dates: Record<string, string> } | null; // последний тест ученика — в него можно добавить разделы
};
/** Для окна «Назначить тест»: уровень грамматики из прошлого теста и последний тест (добавить в него разделы). */
export async function placementInfo(studentId: string): Promise<PlInfo> {
  const me = await requireUser("TEACHER");
  const s = await db.student.findUnique({ where: { id: studentId }, select: { teacherId: true } });
  if (!s || s.teacherId !== me.id) return { grammar: null, last: null };
  const loc = (await getLang()) === "en" ? "en-GB" : "ru-RU";
  const fmt = (d: Date) => d.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: me.timezone ?? "Europe/Moscow" });
  const g = await lastGrammar(studentId);
  const la = await db.placementAttempt.findFirst({ where: { studentId, mode: "student" }, orderBy: { createdAt: "desc" }, select: { id: true, state: true, status: true, createdAt: true } });
  const st = la ? stateOf(la.state) : null;
  return {
    grammar: g ? { sub: g.sub, when: fmt(g.at) } : null,
    last: la && st ? { id: la.id, when: fmt(la.createdAt), status: la.status, done: doneOf(st), parts: partsOf(st), dates: Object.fromEntries(Object.entries(st.sdates ?? {}).map(([k, v]) => [k, fmt(new Date(v as number))])) } : null,
  };
}

const partsIn = (xs?: string[] | null): Section[] | undefined => {
  const p = SECTIONS.filter((x) => (xs ?? []).includes(x));
  return xs && p.length && p.length < SECTIONS.length ? p : undefined;
};
/** Ступень по выбору учителя «начинающий / средний / высокий» — когда грамматику не проверяем и прошлого теста нет. */
const stepOfExpect = (e: Expect, track: Track) => (track === "teen" ? ({ A1: 0, B1: 2, B2: 6 } as const)[e] : EXPECT[e] * 2);

export async function assignPlacement(studentId: string, expected?: string | null, trackIn?: Track, partsRaw?: string[] | null): Promise<R> {
  const me = await requireUser("TEACHER");
  const track = teenOk(trackIn, me.email);
  const s = await db.student.findUnique({ where: { id: studentId } });
  if (!s || s.teacherId !== me.id) return { ok: false, error: "not found" };
  const parts = partsIn(partsRaw);
  if (partsRaw && !parts && !SECTIONS.every((x) => partsRaw.includes(x))) return { ok: false, error: "parts" };
  // без грамматики: уровень — по грамматике прошлого теста, иначе по выбору учителя
  let base: { base: number; baseFrom: "test" | "teacher" } | null = null;
  if (parts && !parts.includes("core")) {
    const g = await lastGrammar(studentId);
    const e = expectOf(expected);
    if (g) base = { base: g.step, baseFrom: "test" };
    else if (e) base = { base: stepOfExpect(e, track), baseFrom: "teacher" };
    else return { ok: false, error: "level" };
  }
  const old = await db.checkpoint.findMany({ where: { studentId, kind: "entry", status: "assigned" }, select: { id: true } });
  if (old.length) {
    await db.placementAttempt.deleteMany({ where: { checkpointId: { in: old.map((x) => x.id) }, status: { in: ["new", "active"] } } });
    await db.checkpoint.deleteMany({ where: { id: { in: old.map((x) => x.id) } } });
  }
  const r = await db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } });
  const c = await db.checkpoint.create({ data: { studentId, roadmapId: r?.id ?? null, kind: "entry", source: "placement" } });
  const seen = await seenBy({ studentId, track });
  await db.placementAttempt.create({ data: { teacherId: me.id, studentId, checkpointId: c.id, mode: "student", track, token: randomToken(24), state: json({ ...withSeen(emptyState(expectOf(expected), track), seen), ...(parts ? { parts } : {}), ...(base ?? {}) }) } });
  if (s.userId) await notify({ userId: s.userId, kind: "test", title: track === "teen" ? "Учитель назначил тебе Placement test Teens — нажми, чтобы начать" : "Преподаватель назначил вам placement test — можно начинать", action: "take", link: `/student/test/${c.id}` });
  // и в «Обновления» учителя — что тест назначен (сразу отмечено сделанным: уйдёт из списка через сутки)
  const mine = await notify({ userId: me.id, kind: "test", title: `${[s.name, s.lastName].filter(Boolean).join(" ")}: назначен ${track === "teen" ? "Placement test Teens" : "placement test"}${s.userId ? "" : " (ученик ещё не вошёл на платформу — увидит после входа)"}`, link: `/teacher/students/${studentId}?tab=roadmap` });
  if (mine) await db.notification.update({ where: { id: mine.id }, data: { readAt: new Date(), doneAt: new Date() } });
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

export type ReviewInput = { regrading?: boolean; rubric?: number; writing: Record<string, number>; speaking: Record<string, number>; points: boolean[]; comment: string; lesson?: { level: string; marks: Record<string, number> } | null; wNote?: string; sNote?: string; wc?: Record<string, string>; sc?: Record<string, string> };
/** Комментарии к критериям: { критерий: текст } — только известные ключи, короткие тексты. */
const cleanNotes = (m: Record<string, string> | undefined) => Object.fromEntries(Object.entries(m ?? {}).filter(([k, v]) => /^[a-z]{2,20}$/.test(k) && typeof v === "string" && v.trim()).map(([k, v]) => [k, v.slice(0, 1500)]));
const cleanScores = (m: Record<string, number> | undefined, max = 5) => Object.fromEntries(Object.entries(m ?? {}).filter(([k, v]) => /^[a-z]{2,20}$/.test(k) && Number.isInteger(v) && v >= 0 && v <= max));

/** Баллы по критериям письма и говорения (v2 — 0–5 по Cambridge, v1 — прежние 0–3), пункты задания письма, комментарий (сохраняются по ходу проверки). */
export async function saveReview(id: string, r: ReviewInput): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    const draft = teacherReview(a);
    if ((r.rubric !== undefined && r.rubric !== 2) || (r.rubric !== 2 && (draft.regrading || draft.active.legacyReview)) ||
        !!r.regrading !== draft.regrading) return changed;
    const points = Array.isArray(r.points) ? r.points.slice(0, 10).map(Boolean) : [];
    const lesson = r.lesson && PL_LEVELS.includes(r.lesson.level as never) ? { level: r.lesson.level, marks: cleanScores(r.lesson.marks) } : r.lesson === null ? null : draft.active.lesson;
    const review = draft.edit({ writing: cleanScores(r.writing), speaking: cleanScores(r.speaking), points,
      comment: str(r.comment, 3000), lesson, wNote: str(r.wNote ?? "", 3000), sNote: str(r.sNote ?? "", 3000), wc: cleanNotes(r.wc), sc: cleanNotes(r.sc) });
    const saved = await db.placementAttempt.updateMany({ where: revision(a), data: { review: json(review) } });
    if (!saved.count) return changed;
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

/** Итог выбирает учитель. Для ученика он становится точкой A маршрута. */
export async function finalizePlacement(id: string, level: string, rubric?: number, regrading = false): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    if (stepIdx(level) < 0) return { ok: false, error: "level" };
    if (a.status !== "submitted" && a.status !== "reviewed") return { ok: false, error: "status" };
    const draft = teacherReview(a);
    if (regrading !== draft.regrading || ((regrading || draft.active.legacyReview) && rubric !== 2)) return changed;
    const missing = regrading && missingReassessment(draft.stored, draft.active);
    if (missing) return { ok: false, error: missing === "writing" ? "Заполните четыре критерия письма по шкале 0–5." : "Заполните четыре критерия говорения по шкале 0–5." };
    const review = regrading ? { ...draft.active, legacyReview: { ...draft.active.legacyReview, at: new Date().toISOString() } } : a.review;
    let checkpointResults: ReturnType<typeof json> | undefined;
    if (a.checkpointId && a.studentId) {
      const st = stateOf(a.state);
      const { bank } = await getBank(trackOf(st.track));
      const sm = summarize(st, bank);
      const pct = (rows: [number, number][]) => { const t = rows.reduce((x, r) => [x[0] + r[0], x[1] + r[1]], [0, 0]); return t[1] ? Math.round((t[0] / t[1]) * 100) : undefined; };
      const skills = {
        grammar: pct(Object.values(sm.core).map((r) => r.grammar)), vocabulary: pct(Object.values(sm.core).map((r) => r.vocabulary)),
        reading: sm.level && sm.reading[sm.level] ? pct([sm.reading[sm.level]]) : undefined, listening: sm.level && sm.listening[sm.level] ? pct([sm.listening[sm.level]]) : undefined,
        ...wsPercent(review), // письмо и говорение — средний балл учителя по критериям
      };
      const wrong = st.core.map((x) => st.items[x.id] as CoreItem).filter((it) => it && !st.answers[it.id]?.ok);
      const right = st.core.map((x) => st.items[x.id] as CoreItem).filter((it) => it && st.answers[it.id]?.ok && it.level !== "A1");
      const uniq = (xs: CoreItem[]) => [...new Map(xs.map((x) => [x.topic_id, [x.topic_en, x.topic_ru]])).values()];
      checkpointResults = json({ skills: Object.fromEntries(Object.entries(skills).filter(([, v]) => v !== undefined)), weak: uniq(wrong).slice(0, 8), strong: uniq(right).slice(0, 4), placement: id, shown: a.showResult });
    }
    const finalized = await db.$transaction(async (tx) => {
      const update = await tx.placementAttempt.updateMany({ where: revision(a), data: { level, status: "reviewed", reviewedAt: new Date(), ...(regrading ? { review: json(review) } : {}) } });
      if (update.count && a.checkpointId && a.studentId && checkpointResults) {
        await tx.checkpoint.update({ where: { id: a.checkpointId }, data: { status: "done", level, takenAt: a.submittedAt ?? new Date(), results: checkpointResults } });
        await tx.student.update({ where: { id: a.studentId }, data: { level } });
      }
      return update.count;
    });
    if (!finalized) return changed;
    refreshT(a.studentId);
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

/** «Отправить ученику в Telegram»: итог теста (уровень и комментарий) — в бот VibeOn, со ссылкой на подробный результат.
 *  Результат заодно открывается ученику в кабинете. */
export async function sendResultTelegram(id: string): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    if (!a.level) return { ok: false, error: "Сначала выставьте итоговый уровень" };
    const u = a.student?.userId ? await db.user.findUnique({ where: { id: a.student.userId }, select: { telegramChatId: true } }) : null;
    if (!u?.telegramChatId || !tgEnabled()) return { ok: false, error: "Ученик ещё не подключил Telegram-бот — попросите его подключить (в анкете, у значка бота)" };
    if (!a.showResult) { const shown = await setShowResult(id, true); if (!shown.ok) return shown; }
    const comment = String(((a.review ?? {}) as { comment?: string }).comment ?? "").trim();
    const name = a.student?.name ?? "";
    const text = `${name ? name + ", " : ""}${a.track === "teen" ? "результат твоего Placement test" : "результат вашего placement test"}: уровень ${a.level}.${comment ? `\n\n${comment.slice(0, 1500)}` : ""}`;
    await tgSend(u.telegramChatId, text, `${env.appUrl}/student/test/${a.checkpointId}`, "Подробный результат");
    await db.$executeRaw`UPDATE "PlacementAttempt" SET review = review || jsonb_build_object('tgSentAt', ${new Date().toISOString()}::text), "updatedAt" = now() WHERE id = ${id}`;
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

/** «Показать результат ученику». */
export async function setShowResult(id: string, on: boolean): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    const review = (a.review ?? {}) as Record<string, unknown>;
    if (on && review.legacyReview && a.status !== "reviewed") return { ok: false, error: "Сначала утвердите итоговый уровень" };
    const saved = await db.placementAttempt.updateMany({ where: revision(a), data: { showResult: !!on, ...(on && !review.shownAt ? { review: json({ ...review, shownAt: new Date().toISOString() }) } : {}) } });
    if (!saved.count) return changed;
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
    const draft = teacherReview(a);
    const revised = draft.stored.cambridgeDraft;
    const previous = revised?.[kind] && Object.keys(revised[kind]).length ? draft.active : draft.stored;
    const rubric = draft.regrading && previous === draft.stored ? 1 : rubricOf(previous).ver;
    st.wsPrev = [...(st.wsPrev ?? []), kind === "writing"
      ? { kind, rubric, id: cur.id, text: (cur as { text: string }).text, marks: previous.writing, points: previous.points }
      : { kind, rubric, id: cur.id, rec: (cur as { rec: Record<string, string> }).rec, rerec: st.rerec, peek: st.peek, marks: previous.speaking }];
    st.items[nx.id] = nx;
    if (kind === "writing") st.writing = { id: nx.id, text: "" };
    else { st.speaking = { id: nx.id, rec: {} }; st.rerec = {}; st.peek = undefined; (st.speaking as { noMic?: boolean }).noMic = undefined; }
    st.wsExtra = { ...(st.wsExtra ?? {}), [kind]: dir > 0 ? 1 : -1 };
    st.closed = LATER.filter((x) => x !== kind);
    st.section = kind; enter(st, kind);
    const clear = { [kind]: {}, ...(kind === "writing" ? { points: [], wc: {}, wNote: "" } : { sc: {}, sNote: "", lesson: null }) };
    const nextReview = { ...review, rubric: draft.regrading ? 1 : 2, ...(draft.regrading ? { legacyReview: draft.active.legacyReview } : {}), ...clear,
      ai: { ...draft.stored.ai, [kind]: undefined }, ...(revised ? { cambridgeDraft: { ...revised, ...clear, ai: { ...revised.ai, [kind]: undefined } } } : {}) };
    if (!(await db.placementAttempt.updateMany({ where: revision(a), data: { state: json(st), review: json(nextReview), status: "active" } })).count) return changed;
    if (a.mode === "student" && a.student?.userId)
      await notify({ userId: a.student.userId, kind: "test", title: kind === "writing" ? "Преподаватель дал дополнительное задание по письму" : "Преподаватель дал дополнительное задание по говорению", action: "decide", link: a.checkpointId ? `/student/test/${a.checkpointId}` : `/placement/${id}` });
    refreshT(a.studentId);
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

/** Дополнительное задание другого уровня в блоке грамматики, лексики, чтения или аудирования (уточнить уровень):
 *  грамматика — 8 заданий уровня, лексика — 6, чтение и аудирование — один текст. Тест снова «проходит» ученик,
 *  результат ученику не показывается, пока учитель не сохранит итог заново. */
export async function assignExtraBlock(id: string, kind: "core" | "vocab" | "reading" | "listening", level: string): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    if (a.status !== "submitted" && a.status !== "reviewed") return { ok: false, error: "status" };
    if (!(PL_LEVELS as readonly string[]).includes(level)) return { ok: false, error: "level" };
    const L = level as (typeof PL_LEVELS)[number];
    const st = stateOf(a.state);
    const { bank } = await getBank(trackOf(st.track));
    const used = new Set([...Object.keys(st.items), ...(st.seen ?? [])]);
    const rnd = () => Math.random();
    const shuffle = <T,>(xs: T[]) => xs.map((x) => [rnd(), x] as const).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
    if (kind === "core" || kind === "vocab") {
      const pool = bank.core.filter((x) => x.level === L && x.skill === (kind === "core" ? "grammar" : "vocabulary") && !used.has(x.id));
      // по одному-два из разных групп тем, простые и сложные вперемешку
      const byGroup = new Map<string, CoreItem[]>();
      for (const x of shuffle(pool)) byGroup.set(x.group ?? x.topic_id, [...(byGroup.get(x.group ?? x.topic_id) ?? []), x]);
      const want = kind === "core" ? 8 : 6, picked: CoreItem[] = [];
      for (let round = 0; picked.length < want && round < 4; round++) for (const g of byGroup.values()) { if (picked.length >= want) break; if (g[round]) picked.push(g[round]); }
      if (!picked.length) return { ok: false, error: "task" };
      for (const x of picked) st.items[x.id] = x;
      st.xq = { kind, level: L, ids: picked.map((x) => x.id) };
      st.section = kind; enter(st, kind);
      advance(st, bank);
    } else {
      const list = (kind === "reading" ? bank.reading : bank.listening) as (ReadItem | ListenItem)[];
      const cand = shuffle(list.filter((x) => x.level === L && !used.has(x.id)));
      const x = cand[0];
      if (!x) return { ok: false, error: "task" };
      st.items[x.id] = x;
      (kind === "reading" ? st.reading : st.listening).push(x.id);
      st.xt = { kind, level: L };
      st.closed = LATER.filter((k) => k !== kind);
      st.section = kind; enter(st, kind);
    }
    st.xs = [...(st.xs ?? []), { kind, level: L, at: Date.now() }];
    await db.placementAttempt.update({ where: { id }, data: { state: json(st), status: "active", showResult: false } });
    const NAME: Record<string, string> = { core: "грамматике", vocab: "лексике", reading: "чтению", listening: "аудированию" };
    if (a.mode === "student" && a.student?.userId)
      await notify({ userId: a.student.userId, kind: "test", title: `Преподаватель дал дополнительное задание по ${NAME[kind]}`, action: "decide", link: a.checkpointId ? `/student/test/${a.checkpointId}` : `/placement/${id}` });
    refreshT(a.studentId);
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

/** «Добавить разделы» в пройденный тест: новые разделы идут в тот же тест, ученик их проходит, результат — там же.
 *  Уже пройденный раздел так не повторить — для сравнения прогресса назначается новый тест. */
export async function addSections(id: string, partsRaw: string[]): Promise<R> {
  return wrap(async () => {
    const acc = await attemptFor(id);
    if (!acc || acc.who !== "teacher") return { ok: false, error: "not found" };
    const { a } = acc;
    if (a.mode !== "student" || (a.status !== "submitted" && a.status !== "reviewed")) return { ok: false, error: "status" };
    const st = stateOf(a.state);
    const done = doneOf(st);
    const add = SECTIONS.filter((x) => partsRaw.includes(x) && !done.includes(x));
    // грамматику нельзя добавить после лексики: лексика уже шла от уровня, выбранного без неё
    if (!add.length || (add.includes("core") && done.includes("vocab"))) return { ok: false, error: "parts" };
    st.parts = [...new Set([...partsOf(st).filter((x) => done.includes(x)), ...add])].sort((x, y) => SECTIONS.indexOf(x) - SECTIONS.indexOf(y));
    st.added = Date.now();
    st.section = "intro";
    await db.placementAttempt.update({ where: { id }, data: { state: json(st), status: "active" } });
    if (a.student?.userId)
      await notify({ userId: a.student.userId, kind: "test", title: "Преподаватель добавил разделы в ваш placement test — можно продолжать", action: "take", link: a.checkpointId ? `/student/test/${a.checkpointId}` : `/placement/${id}` });
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

// ───────── Отчёт (PDF и кабинет ученика) ─────────

/** Настройки отчёта для варианта: язык, включённые блоки, правки текстов (по языкам). */
export async function saveReport(id: string, v: RVariant, cfg: RCfg): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    if (v !== "student" && v !== "parent") return { ok: false, error: "variant" };
    const on = Object.fromEntries(R_BLOCKS.filter((b) => typeof cfg?.on?.[b] === "boolean").map((b) => [b, !!cfg.on[b]]));
    const texts = Object.fromEntries(Object.entries(cfg?.texts ?? {}).filter(([k, t]) => /^(ru|en):(level|strong|work|plan|comment)$/.test(k) && typeof t === "string").map(([k, t]) => [k, str(t, 5000)]));
    const cfgJson = JSON.stringify({ lang: cfg?.lang === "en" ? "en" : "ru", on, texts });
    // Варианты ученика и родителя сохраняются параллельно. Обновляем только свой ключ.
    await db.$executeRaw`UPDATE "PlacementAttempt"
      SET review = jsonb_set(review, '{report}', COALESCE(review->'report', '{}'::jsonb) || jsonb_build_object(${v}::text, ${cfgJson}::jsonb)),
          "updatedAt" = now()
      WHERE id = ${id} AND "teacherId" = ${a.teacherId}`;
    return { ok: true };
  });
}

/** Отправить отчёт (вариант для ученика) в кабинет: ученик видит его на странице теста и получает уведомление. */
export async function sendReport(id: string, on: boolean): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id);
    if (a.mode !== "student") return { ok: false, error: "mode" };
    if (on && (!a.level || a.status !== "reviewed")) return { ok: false, error: "level" }; // ученик видит результат только после утверждения уровня
    const prev = (a.review ?? {}) as Record<string, unknown> & { report?: RSaved };
    const report: RSaved = { ...(prev.report ?? {}), sent: !!on, ...(on ? { sentAt: new Date().toISOString() } : {}) };
    if (!(await db.placementAttempt.updateMany({ where: revision(a), data: { review: json({ ...prev, report }) } })).count) return changed;
    if (on && !a.showResult) return setShowResult(id, true);
    revalidatePath(`/teacher/placement/${id}`);
    return { ok: true };
  });
}

// ───────── ИИ-проверка письма и говорения ─────────

/** Расшифровка принадлежит конкретным записям и доступна до выставления баллов. */
export async function saveSpeechTranscript(id: string, source: string, texts: string[]): Promise<R> {
  return wrap(async () => {
    const { a } = await teacherAttempt(id), st = stateOf(a.state);
    const item = st.speaking && st.items[st.speaking.id] as SpeakItem | undefined;
    if (!item || source !== speechSource(st)) return changed;
    if (!Array.isArray(texts) || texts.length !== item.questions.length || texts.some((v, i) =>
      typeof v !== "string" || v.length > 20000 || (!st.speaking?.rec?.[String(i + 1)] && v !== ""))) return changed;
    if (!texts.some((v) => v.trim())) return { ok: false, error: "emptySpeech" };
    const review = { ...(a.review as object), speechTranscript: { source, texts } };
    const saved = await db.placementAttempt.updateMany({ where: revision(a), data: { review: json(review) } });
    return saved.count ? { ok: true } : changed;
  });
}

/** ИИ ставит баллы по активной шкале по критериям уровня задания и коротко объясняет; учитель потом правит. transcripts — расшифровки ответов говорения. */
export async function aiScore(id: string, kind: "writing" | "speaking", transcripts: string[] = [], rubric?: number, regrading = false, source?: string): Promise<R & { ai?: PlScore; marks?: Record<string, number>; comments?: Record<string, string> }> {
  return wrap(async () => {
    const { me, a } = await teacherAttempt(id);
    // без настоящего ИИ оценка была бы по длине ответа, а расшифровка — шаблонной: честно говорим, что ИИ не подключён
    if (provider() === "mock" && process.env.PL_AI_MOCK !== "1") return { ok: false, error: "off" };
    const st = stateOf(a.state);
    const it = kind === "writing" ? (st.writing ? (st.items[st.writing.id] as WriteItem) : null) : (st.speaking ? (st.items[st.speaking.id] as SpeakItem) : null);
    if (!it) return { ok: false, error: "task" };
    const level = it.level, below = PL_LEVELS[PL_LEVELS.indexOf(level as never) - 1] ?? "";
    const current = teacherReview(a), set = RUB_V2;
    if (regrading !== current.regrading || ((rubric !== undefined || regrading || current.active.legacyReview) && rubric !== 2)) return changed;
    const crit = set[kind].map((c) => ({ id: c.id, name: c.name_ru, en: c.en, level: c.levels?.[level] ?? "", below: below ? c.levels?.[below] ?? "" : "", ...(set.ver === 2 ? { bands: [5, 4, 3, 2, 1, 0].map((v) => `${v} — ${describe5(c, level, v)}`) } : {}) }));
    if (source !== undefined && kind === "speaking" && source !== speechSource(st)) return changed;
    let task: string, answers: string[];
    if (it.type === "writing") {
      task = `${it.prompt_en}${it.points?.length ? `\nIn your answer: ${it.points.join("; ")}.` : ""}\n(${it.min_words}–${it.max_words} words)`;
      answers = [st.writing?.text ?? ""];
    } else {
      const qs = (it as SpeakItem).questions;
      task = qs.map((q, i) => `${i + 1}. ${q.q}`).join("\n");
      if (!Array.isArray(transcripts) || transcripts.some((x) => typeof x !== "string" || x.length > 20000)) return changed;
      answers = qs.map((_, i) => st.speaking?.rec?.[String(i + 1)] ? transcripts[i] ?? "" : "");
      if (!answers.some((x) => x.trim()) || answers.some((x, i) => st.speaking?.rec?.[String(i + 1)] && !x.trim())) return { ok: false, error: "emptySpeech" };
    }
    try {
      const ctx = await aiCtx(me);
      ctx.names = [...(ctx.names ?? []), a.student?.name, a.student?.lastName, a.guestName];
      const ai = await run("plscore", { kind, level, below, teen: st.track === "teen", task, answers, criteria: crit, max: set.max }, ctx);
      const { a: latest } = await teacherAttempt(id);
      const draft = teacherReview(latest);
      const now = stateOf(latest.state);
      if (draft.regrading !== regrading || now[kind]?.id !== it.id ||
          (kind === "speaking" ? speechSource(now) !== speechSource(st) : now.writing?.text !== st.writing?.text)) return changed;
      const noteKey = kind === "speaking" ? "sc" : "wc";
      if (JSON.stringify(current.active[kind]) !== JSON.stringify(draft.active[kind])) return changed;
      const { marks, comments } = applyScore(kind, level, ai, draft.active[kind], draft.active[noteKey], draft.active.ai?.[kind]);
      const review = draft.edit({ [kind]: marks, [noteKey]: comments, ai: { ...draft.active.ai, [kind]: {
        ...ai, level, at: new Date().toISOString(), ...(kind === "speaking" ? { transcripts: answers, source: speechSource(st) } : {}),
      } } });
      const saved = await db.placementAttempt.updateMany({ where: revision(latest), data: { review: json(review) } });
      if (!saved.count) return changed;
      revalidatePath(`/teacher/placement/${id}`);
      return { ok: true, ai, marks, comments };
    } catch (e) {
      return { ok: false, error: aiCode(e) };
    }
  });
}
