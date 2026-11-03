import "server-only";
import { db } from "../db";
import type { Rubric, TaskOptions, TaskType } from "../tasks/catalog";

/** Урок со всеми заданиями в порядке показа: рубрики «Урока», затем домашка и слова. */
export async function loadLesson(id: string) {
  const l = await db.lessonTemplate.findUnique({
    where: { id },
    include: { tasks: { orderBy: { order: "asc" } }, unit: { include: { course: true, lessons: { select: { id: true }, orderBy: { order: "asc" } } } } },
  });
  if (!l) return null;
  const units = await db.unit.findMany({ where: { courseId: l.unit.courseId }, orderBy: { order: "asc" }, include: { lessons: { select: { id: true }, orderBy: { order: "asc" } } } });
  const unitNo = units.findIndex((u) => u.id === l.unitId) + 1;
  const flat = units.flatMap((u) => u.lessons.map((x) => x.id));
  const rubrics = ((l.sections as Rubric[]) ?? []).filter((r) => r?.id);
  const tasks = l.tasks.map((t) => ({
    id: t.id, type: t.type as TaskType, title: t.title, content: t.content, options: (t.options ?? {}) as TaskOptions,
    section: t.section as "lesson" | "homework" | "words", rubricId: t.rubricId, hidden: t.hidden,
  }));
  return { l, unitNo, lessonNo: flat.indexOf(l.id) + 1, rubrics, tasks };
}

/** Задания по порядку для печати и «Поделиться». */
export function ordered(rubrics: Rubric[], tasks: Awaited<ReturnType<typeof loadLesson>> extends infer X ? X extends { tasks: infer T } ? T : never : never) {
  const first = rubrics[0]?.id;
  const groups = rubrics.map((r) => ({ title: r.title, tasks: tasks.filter((t) => t.section === "lesson" && (t.rubricId === r.id || (!t.rubricId && r.id === first)) && !t.hidden) }));
  const orphan = tasks.filter((t) => t.section === "lesson" && t.rubricId && !rubrics.some((r) => r.id === t.rubricId) && !t.hidden);
  if (orphan.length && groups[0]) groups[0].tasks.push(...orphan);
  return { lesson: groups.filter((g) => g.tasks.length), homework: tasks.filter((t) => t.section === "homework" && !t.hidden), words: tasks.filter((t) => t.section === "words" && !t.hidden) };
}
