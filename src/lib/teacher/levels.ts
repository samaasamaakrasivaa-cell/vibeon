import "server-only";
import { db } from "../db";

export type Levels = { quest: string | null; now: string | null; goal: string | null; course: string | null };

/** Уровни ученика для шапки анкеты и карточек: по анкете, сейчас (последний тест / срез / точка A), цель маршрута, курс. */
export async function levelsOf(students: { id: string; level: string | null; course: string | null; courseId: string | null }[]): Promise<Map<string, Levels>> {
  const ids = students.map((s) => s.id);
  if (!ids.length) return new Map();
  const [cps, rms, tests] = await Promise.all([
    db.checkpoint.findMany({ where: { studentId: { in: ids }, status: "done", level: { not: null } }, orderBy: { takenAt: "desc" }, select: { studentId: true, level: true } }),
    db.roadmap.findMany({ where: { studentId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { studentId: true, goal: true, fromLevel: true, leadCourseId: true } }),
    db.placementAttempt.findMany({ where: { studentId: { in: ids }, level: { not: null } }, orderBy: { reviewedAt: "desc" }, select: { studentId: true, level: true } }),
  ]);
  const courseIds = [...new Set([...students.map((s) => s.courseId), ...rms.map((r) => r.leadCourseId)].filter(Boolean) as string[])];
  const courses = new Map((await db.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, title: true } })).map((c) => [c.id, c.title]));
  const first = <T extends { studentId: string | null }>(xs: T[], id: string) => xs.find((x) => x.studentId === id);
  return new Map(students.map((s) => {
    const rm = first(rms, s.id);
    return [s.id, {
      quest: s.level || null,
      now: first(cps, s.id)?.level ?? first(tests, s.id)?.level ?? rm?.fromLevel ?? null,
      goal: rm?.goal ?? null,
      course: (s.courseId && courses.get(s.courseId)) || (rm?.leadCourseId && courses.get(rm.leadCourseId)) || s.course || null,
    }];
  }));
}

/** «B1 → B2 · Speaking B2»: коротко для карточки ученика. */
export const levelLine = (l: Levels | undefined) => {
  if (!l) return "";
  const lv = l.now && l.goal ? `${l.now} → ${l.goal}` : l.now ?? (l.goal ? `→ ${l.goal}` : l.quest ?? "");
  return [lv, l.course].filter(Boolean).join(" · ");
};
