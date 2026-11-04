import "server-only";
import { db } from "./db";
import { TYPES, type TaskType } from "./tasks/catalog";

export type HwState = "review" | "notdone" | "checked";

/** Домашки по занятиям: сколько заданий сделано, что ждёт проверки. */
export async function homeworkFor(where: { teacherId?: string; studentId?: string }) {
  const lessons = await db.lessonInstance.findMany({
    where: { ...where, status: "DONE", homework: { isNot: null } },
    include: { homework: true, template: { include: { tasks: { select: { id: true, type: true, title: true } } } }, student: true, answers: true },
    orderBy: { finishedAt: "desc" },
    take: 200,
  });
  return lessons.map((l) => {
    const hw = l.homework!;
    const ids = [...new Set([...hw.taskIds, ...hw.extraTaskIds])];
    const tasks = (l.template?.tasks ?? []).filter((t) => ids.includes(t.id));
    const ans = l.answers.filter((a) => ids.includes(a.taskId) && Object.keys((a.payload as object) ?? {}).length > 0);
    const needs = ans.filter((a) => a.status === "NEEDS_REVIEW" && !a.teacherReview).length;
    const teacherTasks = tasks.filter((t) => TYPES[t.type as TaskType]?.teacherCheck);
    const reviewed = l.answers.filter((a) => a.teacherReview && ids.includes(a.taskId)).length;
    const total = tasks.length + hw.wordTraining.length;
    const done = ans.length;
    const state: HwState = needs > 0 ? "review" : done === 0 && total > 0 ? "notdone" : done >= tasks.length && reviewed >= teacherTasks.length ? "checked" : done > 0 ? "review" : "notdone";
    const last = ans.reduce<Date | null>((m, a) => (!m || a.updatedAt > m ? a.updatedAt : m), null);
    return { lesson: l, title: l.template?.title ?? "—", total, done: Math.min(done, total), needs, state, lastAt: last, comment: hw.teacherComment };
  });
}
