import "server-only";
import { getBank, RUBRICS, trackOf } from "./bank";
import { finalHint, scoreStep, STEPS, summarize, type PLevel, type PState } from "./engine";
import { reviewData } from "./review";
import type { RInput, RSaved, RSkill } from "./report";

type Attempt = { id: string; mode: string; level: string | null; review: unknown; guestName: string | null; student?: { name: string; lastName?: string | null } | null; submittedAt: Date | null; startedAt: Date | null; createdAt: Date };
type Marks = Record<string, number>;

/** Всё, что нужно для отчёта: входные данные для текстов, разбор ответов, оценки письма и говорения. */
export async function reportData(a: Attempt, st: PState) {
  const { bank } = await getBank(trackOf(st.track));
  const sm = summarize(st, bank);
  const d = reviewData(a.id, st, true);
  const rv = (a.review ?? {}) as { writing?: Marks; speaking?: Marks; comment?: string; lesson?: { level: string; marks: Marks } | null; report?: RSaved };
  const W = RUBRICS.writing.criteria, S = RUBRICS.speaking.criteria;
  const w = rv.writing ?? {}, s = rv.speaking ?? {};
  const wStep = d.writing ? scoreStep(W.map((c) => w[c.id]), d.writing.level as PLevel, w.task) : null;
  const sTask = d.speaking ? scoreStep(S.map((c) => s[c.id]), d.speaking.level as PLevel) : null;
  const sLesson = rv.lesson ? scoreStep(S.map((c) => rv.lesson!.marks[c.id]), rv.lesson.level as PLevel) : null;
  const sStep = sLesson ?? sTask;
  const parts = [sm.coreStep, sm.vstep, sm.readStep, sm.listenStep, wStep, sStep];
  const hint = finalHint(parts);
  const sub = (x: number | null | undefined) => (typeof x === "number" ? STEPS[x] : null);
  const skills: Record<RSkill, string | null> = { core: sub(sm.coreStep), vocab: sub(sm.vstep), reading: sub(sm.readStep), listening: sub(sm.listenStep), writing: sub(wStep), speaking: sub(sStep) };
  const name = a.mode === "student" ? `${a.student?.name ?? ""} ${a.student?.lastName ?? ""}`.trim() : a.guestName ?? "";
  const input: RInput = {
    name, teen: st.track === "teen", level: a.level ?? sub(hint), skills, vweak: sm.vweak, comment: rv.comment ?? "",
    families: sm.families.map((f) => { const r = f.lvl[1] >= 2 ? f.lvl : f.all; return { id: f.id, name: f.name, c: r[0], n: r[1] }; }),
  };
  const writing = d.writing && { ...d.writing, marks: W.map((c) => ({ id: c.id, name: c.name_ru, v: typeof w[c.id] === "number" ? w[c.id] : null })) };
  const speaking = d.speaking && { level: d.speaking.level, marks: S.map((c) => ({ id: c.id, name: c.name_ru, v: typeof s[c.id] === "number" ? s[c.id] : null })) };
  return { input, d, writing, speaking, saved: rv.report ?? {}, finalLevel: a.level, date: (a.submittedAt ?? a.startedAt ?? a.createdAt).toISOString() };
}
export type ReportDataT = Awaited<ReturnType<typeof reportData>>;
