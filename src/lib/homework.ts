import "server-only";
import { db } from "./db";
import { TYPES, type TaskOptions, type TaskType } from "./tasks/catalog";
import { progressOf, summary } from "./tasks/progress";

export type HwState = "review" | "partial" | "notdone" | "checked";

/** Ответ ученика по заданию сделан целиком (все пропуски/вопросы заполнены) — как зелёная отметка в уроке.
 *  null — в задании нечего делать (текст для чтения, видео, слова): в счёт домашки не идёт. */
function taskDone(task: { id: string; type: string; content: string; options: unknown }, payload: unknown): boolean | null {
  const a = (payload && typeof payload === "object" ? payload : undefined) as Record<string, unknown> | undefined;
  const st = progressOf({ ...task, type: task.type as TaskType, options: (task.options ?? {}) as TaskOptions }, a);
  if (!st) return null;
  return summary(st).done;
}

/** Домашки по занятиям: сколько заданий сделано, что ждёт проверки.
 *  «Сдано» (review) — сделаны все задания или есть работа, которую ученик отправил на проверку и она сделана целиком;
 *  «В процессе» (partial) — начал, но сделал не всё; «Не сделано» — ни одного ответа. */
export async function homeworkFor(where: { teacherId?: string; studentId?: string }) {
  const lessons = await db.lessonInstance.findMany({
    where: { ...where, status: "DONE", homework: { isNot: null } },
    include: { homework: true, template: { include: { tasks: { select: { id: true, type: true, title: true, content: true, options: true } } } }, student: true, answers: true },
    orderBy: { finishedAt: "desc" },
    take: 200,
  });
  return lessons.map((l) => {
    const hw = l.homework!;
    const ids = [...new Set([...hw.taskIds, ...hw.extraTaskIds])].filter((x) => !hw.removedTaskIds.includes(x));
    const byTask = new Map(l.answers.map((a) => [a.taskId, a]));
    // задания, в которых есть что делать; сделано — когда заполнено целиком (комментарии и исправления учителя не в счёт)
    const tasks = (l.template?.tasks ?? []).filter((t) => ids.includes(t.id)).map((t) => ({ t, done: taskDone(t, byTask.get(t.id)?.payload) })).filter((x) => x.done !== null);
    const doneTasks = tasks.filter((x) => x.done);
    const started = tasks.filter((x) => { const p = byTask.get(x.t.id)?.payload as Record<string, unknown> | undefined; return !!p && Object.keys(p).some((k) => !["gnotes", "corr", "corrSent", "hist", "tries", "checked", "rounds"].includes(k)); });
    const doneIds = new Set(doneTasks.map((x) => x.t.id));
    const needs = l.answers.filter((a) => doneIds.has(a.taskId) && a.status === "NEEDS_REVIEW" && !a.teacherReview).length;
    const teacherTasks = tasks.filter((x) => TYPES[x.t.type as TaskType]?.teacherCheck);
    const reviewed = l.answers.filter((a) => a.teacherReview && ids.includes(a.taskId)).length;
    const total = tasks.length;
    const done = doneTasks.length;
    const all = total > 0 && done >= total;
    const state: HwState = all ? (reviewed >= teacherTasks.length && needs === 0 ? "checked" : "review") : done > 0 || started.length > 0 ? "partial" : "notdone";
    const ans = l.answers.filter((a) => ids.includes(a.taskId));
    const last = ans.reduce<Date | null>((m, a) => (!m || a.updatedAt > m ? a.updatedAt : m), null);
    // активное время над домашкой — вне урока по расписанию
    const timeMs = ans.reduce((a2, x) => a2 + x.hwMs, 0);
    return { lesson: l, title: l.template?.title ?? "—", total, done, needs, state, lastAt: last, comment: hw.teacherComment, words: hw.wordTraining.length, timeMs };
  }).filter((h) => h.total > 0 || h.words > 0); // учитель ничего не задал — домашки нет (а не «не сделано»)
}
