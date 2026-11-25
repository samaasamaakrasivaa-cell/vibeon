import "server-only";
import { getBank, trackOf } from "./bank";
import { finalHint, STEPS, summarize, type PLevel, type PState, type V6Topic } from "./engine";
import { gateKey, rubricOf, stepBy, weakAt } from "./rubric";
import { reviewData } from "./review";
import type { RInput, RSaved, RSkill } from "./report";

type Attempt = { id: string; mode: string; level: string | null; review: unknown; guestName: string | null; student?: { name: string; lastName?: string | null } | null; submittedAt: Date | null; startedAt: Date | null; createdAt: Date };
type Marks = Record<string, number>;
const reportTopic = ({ id, name, nameEn, level, c, n, verdict }: V6Topic) => ({ id, name, nameEn, level, c, n, verdict });

/** Всё, что нужно для отчёта: входные данные для текстов, разбор ответов, оценки письма и говорения. */
export async function reportData(a: Attempt, st: PState) {
  const { bank } = await getBank(trackOf(st.track));
  const sm = summarize(st, bank);
  const d = reviewData(a.id, st, true);
  const rv = (a.review ?? {}) as { writing?: Marks; speaking?: Marks; comment?: string; lesson?: { level: string; marks: Marks } | null; report?: RSaved; wNote?: string; sNote?: string; wc?: Record<string, string>; sc?: Record<string, string> };
  const set = rubricOf(rv as never), W = set.writing, S = set.speaking, weak = weakAt(set);
  const w = rv.writing ?? {}, s = rv.speaking ?? {};
  const wStep = d.writing ? stepBy(set, W.map((c) => w[c.id]), d.writing.level as PLevel, w[gateKey(set)]) : null;
  const sTask = d.speaking ? stepBy(set, S.map((c) => s[c.id]), d.speaking.level as PLevel) : null;
  const sLesson = rv.lesson ? stepBy(set, S.map((c) => rv.lesson!.marks[c.id]), rv.lesson.level as PLevel) : null;
  const sStep = sLesson ?? sTask;
  const speakingLesson = sLesson === null ? null : rv.lesson;
  const speakingMarks = speakingLesson?.marks ?? s;
  const grammarStep = Object.values(sm.core).some((row) => row.grammar[1] > 0) ? sm.coreStep : null;
  const parts = [grammarStep, sm.vstep, sm.readStep, sm.listenStep, wStep, sStep];
  const hint = finalHint(parts);
  const sub = (x: number | null | undefined) => (typeof x === "number" ? STEPS[x] : null);
  const skills: Record<RSkill, string | null> = { core: sub(grammarStep), vocab: sub(sm.vstep), reading: sub(sm.readStep), listening: sub(sm.listenStep), writing: sub(wStep), speaking: sub(sStep) };
  const name = a.mode === "student" ? `${a.student?.name ?? ""} ${a.student?.lastName ?? ""}`.trim() : a.guestName ?? "";
  const input: RInput = {
    name, teen: st.track === "teen", level: a.level ?? sub(hint), skills, vweak: sm.vweak, comment: rv.comment ?? "",
    families: sm.families.map((f) => { const r = f.lvl[1] >= 2 ? f.lvl : f.all; return { id: f.id, name: f.name, c: r[0], n: r[1] }; }),
    grammarDetail: sm.v6?.found ? { level: sm.v6.found, topics: sm.v6.topics.map(reportTopic), base: sm.v6.base.map(reportTopic), coverageKnown: sm.v6.coverageKnown } : undefined,
    // Для прежнего формата теста доступны итоги по группам.
    gweak: sm.v6?.found ? undefined : sm.groups.filter((g) => g.c < g.n && g.c / g.n < 0.8).sort((x, y) => (y.n - y.c) - (x.n - x.c)).map((g) => g.name),
    wsWeak: [
      ...W.filter((c) => typeof w[c.id] === "number" && w[c.id] <= weak).map((c) => ({ kind: "writing" as const, id: c.id, name: c.name_ru, v: w[c.id] })),
      ...S.filter((c) => typeof speakingMarks[c.id] === "number" && speakingMarks[c.id] <= weak).map((c) => ({ kind: "speaking" as const, id: c.id, name: c.name_ru, v: speakingMarks[c.id] })),
    ],
  };
  // комментарий преподавателя к оценке — рядом с баллами в отчёте
  const writing = d.writing && { ...d.writing, note: rv.wNote ?? "", marks: W.map((c) => ({ id: c.id, name: c.name_ru, v: typeof w[c.id] === "number" ? w[c.id] : null, note: rv.wc?.[c.id] ?? "" })) };
  const speakingLevel = speakingLesson?.level ?? d.speaking?.level;
  const speaking = speakingLevel ? { level: speakingLevel, note: rv.sNote ?? "", marks: S.map((c) => ({ id: c.id, name: c.name_ru, v: typeof speakingMarks[c.id] === "number" ? speakingMarks[c.id] : null, note: rv.sc?.[c.id] ?? "" })) } : null;
  return { input, d, writing, speaking, max: set.max, saved: rv.report ?? {}, finalLevel: a.level, date: (a.submittedAt ?? a.startedAt ?? a.createdAt).toISOString() };
}
export type ReportDataT = Awaited<ReturnType<typeof reportData>>;
