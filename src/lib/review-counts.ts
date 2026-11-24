import "server-only";
import { db } from "./db";
import { homeworkFor } from "./homework";

/** «На проверку»: сколько ждёт учителя — по тем же правилам, что и в самом разделе (число в меню = число в разделе).
 *  Домашка: последняя домашка каждого ученика, сданная на проверку. Тесты: пройденные учениками placement test.
 *  Вопросы: «Мне непонятно», на которые учитель ещё не ответил.  Тесты — только активных учеников (как в разделе). */
export async function reviewCounts(teacherId: string) {
  const [items, tests, questions] = await Promise.all([
    homeworkFor({ teacherId }),
    db.placementAttempt.count({ where: { teacherId, mode: "student", status: "submitted", studentId: { not: null }, student: { status: "ACTIVE" } } }),
    db.question.count({ where: { student: { teacherId }, askedTeacher: true, answeredAt: null } }),
  ]);
  const latest = new Map<string, (typeof items)[number]>();
  for (const h of items) if (h.lesson.studentId && !latest.has(h.lesson.studentId)) latest.set(h.lesson.studentId, h);
  const hw = [...latest.values()].filter((h) => h.state === "review").length;
  return { hw, tests, questions, total: hw + tests + questions };
}
