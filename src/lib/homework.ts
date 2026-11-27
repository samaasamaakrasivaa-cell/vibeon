import "server-only";
import { db } from "./db";
import { currentHomeworkAnswers, homeworkTaskDone, needsHomeworkReview } from "./homework-review";

export type HwState = "review" | "partial" | "notdone" | "checked";

/** Домашки по занятиям: сколько заданий сделано, что ждёт проверки.
 *  «Сдано» (review) — задания сделаны целиком и хотя бы одно ждёт ручной проверки;
 *  «В процессе» (partial) — начал, но сделал не всё; «Не сделано» — ни одного ответа. */
export async function homeworkFor(where: { teacherId?: string; studentId?: string }) {
  const lessons = await db.lessonInstance.findMany({
    where: { ...where, status: "DONE", homework: { isNot: null } },
    include: { homework: true, template: { include: { tasks: { select: { id: true, type: true, title: true, content: true, options: true, section: true, hidden: true } } } }, student: true, answers: true },
    orderBy: { finishedAt: "desc" },
    take: 200,
  });
  return lessons.map((l) => {
    const hw = l.homework!;
    const ids = [...new Set([...hw.taskIds, ...hw.extraTaskIds])].filter((x) => !hw.removedTaskIds.includes(x));
    const byTask = new Map(currentHomeworkAnswers(l.answers, l.id, l.studentId).map((a) => [a.taskId, a]));
    // задания, в которых есть что делать; сделано — когда заполнено целиком (комментарии и исправления учителя не в счёт)
    const tasks = (l.template?.tasks ?? []).filter((t) => ids.includes(t.id)).map((t) => ({ t, done: homeworkTaskDone(t, byTask.get(t.id)?.payload) })).filter((x) => x.done !== null);
    const doneTasks = tasks.filter((x) => x.done);
    const started = tasks.filter((x) => { const p = byTask.get(x.t.id)?.payload as Record<string, unknown> | undefined; return !!p && Object.keys(p).some((k) => !["gnotes", "corr", "corrSent", "hist", "tries", "checked", "rounds"].includes(k)); });
    const needs = (l.template?.tasks ?? []).filter((task) => {
      const answer = byTask.get(task.id);
      return needsHomeworkReview(task, hw, answer?.payload, answer?.status, !!answer?.teacherReview);
    }).length;
    const total = tasks.length;
    const done = doneTasks.length;
    const all = total > 0 && done >= total;
    const state: HwState = all ? (needs > 0 ? "review" : "checked") : done > 0 || started.length > 0 ? "partial" : "notdone";
    const ans = l.answers.filter((a) => ids.includes(a.taskId));
    const last = ans.reduce<Date | null>((m, a) => (!m || a.updatedAt > m ? a.updatedAt : m), null);
    // активное время над домашкой — вне урока по расписанию
    const timeMs = ans.reduce((a2, x) => a2 + x.hwMs, 0);
    return { lesson: l, title: l.template?.title ?? "—", total, done, needs, state, lastAt: last, comment: hw.teacherComment, words: hw.wordTraining.length, timeMs };
  }).filter((h) => h.total > 0 || h.words > 0); // учитель ничего не задал — домашки нет (а не «не сделано»)
}
