"use server";
import { isDeepStrictEqual } from "node:util";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { getT } from "../i18n/server";
import { llmFor, run } from "../ai/gateway";
import { modelLabel, modelsFor } from "../ai/models";
import { prompt } from "../ai/prompts";
import { scrubWithMap } from "../ai/check-core";
import { aiCode, aiCtx } from "../ai/ctx";
import { goalLevel, LEVELS, ROUTE_TYPES, SKILLS, type Stage } from "./cefr";
import { grade, itemsFor, WRITING_PROMPT } from "./testbank";
import { etaDate, paceKey, PACES, parsePace, routeState } from "./math";
import { lessonMinOf, roadmapView } from "./progress";
import { notify } from "../notify";
import { roadmapChanged, writeRoadmapStages } from "./stage-writes";

type R = { ok: true; id?: string } | { ok: false; error: string };
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function own(studentId: string) {
  const me = await requireUser("TEACHER");
  const s = await db.student.findUnique({ where: { id: studentId } });
  if (!s || s.teacherId !== me.id) throw new Error("not found");
  return { me, s };
}
const refresh = (sid: string) => { revalidatePath(`/teacher/students/${sid}`); revalidatePath("/teacher/students"); revalidatePath("/student/route"); revalidatePath("/student/schedule"); revalidatePath("/student/tests"); revalidatePath("/student"); };

// ───────── Тесты ─────────

/** «Назначить входной тест» / «Назначить срез»: ученик получает уведомление и проходит тест в кабинете. */
export async function assignTest(studentId: string, kind: "entry" | "slice" | "final", stage?: number): Promise<R> {
  const { s } = await own(studentId);
  const r = await db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } });
  await db.checkpoint.deleteMany({ where: { studentId, status: "assigned", kind } }); // один открытый тест одного вида
  const c = await db.checkpoint.create({ data: { studentId, roadmapId: r?.id ?? null, kind, stage: stage ?? null } });
  if (s.userId) await notify({ userId: s.userId, kind: "test", title: kind === "entry" ? "Преподаватель назначил placement test" : "Преподаватель назначил контрольный срез", action: "decide", link: `/student/test/${c.id}` });
  refresh(studentId);
  return { ok: true, id: c.id };
}

/** Результаты внешнего теста — вручную. */
export async function manualResults(studentId: string, kind: "entry" | "slice", level: string, skills: Record<string, number>): Promise<R> {
  await own(studentId);
  if (!(LEVELS as readonly string[]).includes(level)) return { ok: false, error: "level" };
  const clean = Object.fromEntries(Object.entries(skills).filter(([k, v]) => (SKILLS as readonly string[]).includes(k) && v >= 0 && v <= 100).map(([k, v]) => [k, Math.round(v)]));
  const r = await db.roadmap.findFirst({ where: { studentId }, orderBy: { createdAt: "desc" } });
  await db.checkpoint.deleteMany({ where: { studentId, status: "assigned", kind } });
  await db.checkpoint.create({ data: { studentId, roadmapId: r?.id ?? null, kind, status: "done", source: "manual", level, results: json({ skills: clean, weak: [], strong: [] }), takenAt: new Date() } });
  refresh(studentId);
  return { ok: true };
}

export async function deleteCheckpoint(id: string): Promise<R> {
  const c = await db.checkpoint.findUnique({ where: { id } });
  if (!c) return { ok: false, error: "not found" };
  await own(c.studentId);
  await db.placementAttempt.deleteMany({ where: { checkpointId: id } });
  await db.checkpoint.delete({ where: { id } });
  refresh(c.studentId);
  return { ok: true };
}

/** Ученик сдаёт тест. Письмо проверяет ИИ (как эссе): меньше ошибок на 100 слов — выше балл. */
export async function submitTest(id: string, answers: Record<string, number>, writing: string): Promise<R & { level?: string }> {
  const user = await requireUser("STUDENT");
  const c = await db.checkpoint.findUnique({ where: { id }, include: { student: true, roadmap: true } });
  if (!c || c.student.userId !== user.id) return { ok: false, error: "not found" };
  if (c.status === "done") return { ok: true, level: c.level ?? undefined };
  const stages = (c.roadmap?.stages as Stage[] | undefined) ?? [];
  const items = itemsFor(c.kind as "entry", c.kind === "entry" ? null : stages[c.stage ?? 0]?.lvl);
  let wScore: number | null = null, wCheck: unknown = null;
  const text = str(writing, 4000);
  if (text) {
    const words = text.split(/\s+/).filter(Boolean).length;
    try {
      const ch = await run("essay", { task: WRITING_PROMPT, text, level: c.student.level ?? undefined, limit: 120 }, await aiCtx(user));
      const per100 = (ch.notes.length / Math.max(1, words)) * 100;
      wScore = Math.max(20, Math.min(100, Math.round(100 - per100 * 7))) * (words < 30 ? 0.6 : 1);
      wCheck = { ...ch, source: text };
    } catch { wScore = null; }
  }
  const res = grade(items, answers, wScore);
  const takenAt = new Date();
  const saved = await db.$transaction(async (tx) => {
    const { count } = await tx.checkpoint.updateMany({
      where: { id, studentId: c.studentId, roadmapId: c.roadmapId, kind: c.kind, stage: c.stage, status: { not: "done" } },
      data: { status: "done", level: res.level, results: json({ ...res, writingCheck: wCheck }), answers: json({ answers, writing: text }), takenAt },
    });
    if (!count) return false;

    // Grading can take time. Lock and read the current stages only when committing the result.
    const index = c.stage;
    if (c.roadmap && c.kind !== "entry" && index !== null && stages[index] && res.score >= 70) {
      const [route] = await tx.$queryRaw<Pick<typeof c.roadmap, "id" | "approvedAt" | "builtAt" | "stages">[]>`
        SELECT id, "approvedAt", "builtAt", stages FROM "Roadmap" WHERE id = ${c.roadmap.id} FOR UPDATE
      `;
      const current = route?.stages as Stage[] | undefined;
      const stage = current?.[index];
      const previous = stages[index];
      const identity = (s: Stage) => s.points?.length ? s.points.map((p) => p.id) : s.grammar;
      if (route && current && stage && current.length === stages.length && route.builtAt?.getTime() === c.roadmap.builtAt?.getTime()
        && stage.lvl === previous.lvl && isDeepStrictEqual(identity(stage), identity(previous))) {
        const next = [...current];
        next[index] = { ...stage, passed: { score: res.score, at: takenAt.toISOString() } };
        if (!await writeRoadmapStages(route, { stages: json(next) }, tx)) throw new Error("Locked Roadmap changed before checkpoint commit");
      }
    }
    return true;
  });
  if (!saved) {
    const latest = await db.checkpoint.findUnique({ where: { id }, select: { studentId: true, status: true, level: true } });
    return latest?.studentId === c.studentId && latest.status === "done"
      ? { ok: true, level: latest.level ?? undefined }
      : roadmapChanged();
  }
  await notify({ userId: c.student.teacherId, kind: "test", title: `${c.student.name} ${c.kind === "entry" ? "прошёл(ла) placement test" : "прошёл(ла) срез"}: ${res.level}, ${res.score}%`, action: "review", link: `/teacher/students/${c.studentId}?tab=roadmap` });
  refresh(c.studentId);
  return { ok: true, level: res.level };
}

// ───────── Маршрут ─────────

export type RoadmapForm = { type: string; goal: string; fromLevel: string; courseIds: string[]; leadCourseId: string | null; deadline: string | null; showDate: boolean; pace: string; mood: string; note: string };

/** Учитель правит этап: название и часы. */
export async function editStage(roadmapId: string, i: number, patch: { title?: string; hours?: number }): Promise<R> {
  const r = await db.roadmap.findUnique({ where: { id: roadmapId } });
  if (!r) return { ok: false, error: "not found" };
  await own(r.studentId);
  const stages = structuredClone((r.stages as Stage[]) ?? []);
  if (!stages[i]) return { ok: false, error: "stage" };
  if (patch.title !== undefined) stages[i].title = str(patch.title, 120) || stages[i].title;
  if (patch.hours !== undefined && patch.hours > 0 && patch.hours <= 500) stages[i].hours = Math.round(patch.hours);
  if (!await writeRoadmapStages(r, { stages: json(stages) })) return roadmapChanged();
  refresh(r.studentId);
  return { ok: true };
}

/** «Утвердить»: маршрут с картой появляется у ученика. Прогноз фиксируется — от него считается «отстаёт / опережает». */
export async function approveRoadmap(id: string, on = true): Promise<R> {
  const r = await db.roadmap.findUnique({ where: { id }, include: { student: true } });
  if (!r) return { ok: false, error: "not found" };
  await own(r.studentId);
  if (!on) { await db.roadmap.update({ where: { id }, data: { approvedAt: null } }); refresh(r.studentId); return { ok: true }; }
  const v = await roadmapView(r.studentId, r.student.timezone);
  const left = v.r ? routeState(v.stages, v.done).left : 0;
  await db.roadmap.update({ where: { id }, data: { approvedAt: r.approvedAt ?? new Date(), baseEta: etaDate(left, parsePace(r.paceStudent ?? r.pace), v.r ? v.lessonMin : 60) } });
  if (r.student.userId) await notify({ userId: r.student.userId, kind: "roadmap", title: "Твой маршрут к цели готов", action: "review", link: "/student/route" });
  refresh(r.studentId);
  return { ok: true };
}

/** Ученик выбирает темп — прогноз пересчитывается. */
export async function setStudentPace(pace: string): Promise<R> {
  const user = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: user.id } });
  if (!s || !(PACES.some((p) => paceKey(p) === pace) || /^[1-7]:\d{1,3}$/.test(pace))) return { ok: false, error: "pace" };
  const r = await db.roadmap.findFirst({ where: { studentId: s.id, approvedAt: { not: null } }, orderBy: { createdAt: "desc" } });
  if (!r) return { ok: false, error: "no roadmap" };
  await db.roadmap.update({ where: { id: r.id }, data: { paceStudent: pace } });
  refresh(s.id);
  return { ok: true };
}

/** Ученик сам начинает срез, когда дошёл до точки. */
export async function startStageTest(stage: number): Promise<R> {
  const user = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: user.id } });
  if (!s) return { ok: false, error: "no student" };
  const r = await db.roadmap.findFirst({ where: { studentId: s.id, approvedAt: { not: null } }, orderBy: { createdAt: "desc" } });
  if (!r) return { ok: false, error: "no roadmap" };
  const stages = (r.stages as Stage[]) ?? [];
  const kind = stage === stages.length - 1 ? "final" : "slice";
  const open = await db.checkpoint.findFirst({ where: { studentId: s.id, status: "assigned", stage } });
  const c = open ?? await db.checkpoint.create({ data: { studentId: s.id, roadmapId: r.id, kind, stage } });
  return { ok: true, id: c.id };
}
