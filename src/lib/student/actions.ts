"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { chatAccess } from "./access";
import { getT } from "../i18n/server";
import { publish } from "../live/bus";
import { hashPassword, MIN_PASSWORD, verifyPassword } from "../auth/password";
import { isoDay } from "../time";
import { notify } from "../notify";

export type R = { ok: true } | { ok: false; error: string };
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function myStudent() {
  const u = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: u.id } });
  if (!s) throw new Error("no student");
  return { u, s };
}

/** Сообщение в переписке учитель ↔ ученик. */
export async function sendMessage(studentId: string, text: string): Promise<R> {
  const acc = await chatAccess(studentId);
  if (!acc) return { ok: false, error: "forbidden" };
  const body = str(text, 4000);
  if (!body) return { ok: false, error: "empty" };
  const m = await db.message.create({ data: { studentId, senderId: acc.u.id, text: body } });
  publish(`chat:${studentId}`, "chat", { id: m.id, text: body, by: acc.u.id, at: m.createdAt });
  const to = acc.u.role === "TEACHER" ? acc.s.userId : acc.s.teacherId;
  if (to) {
    const last = await db.notification.findFirst({ where: { userId: to, kind: "message", readAt: null }, orderBy: { createdAt: "desc" } });
    // одно непрочитанное уведомление на переписку, а не на каждое сообщение
    if (!last || !last.link?.includes(studentId))
      await notify({ userId: to, kind: "message", title: `${acc.u.name}: ${body.slice(0, 100)}`, action: "reply", link: acc.u.role === "TEACHER" ? "/student/messages" : `/teacher/chat?s=${studentId}` });
  }
  return { ok: true };
}

export async function markThreadRead(studentId: string): Promise<R> {
  const acc = await chatAccess(studentId);
  if (!acc) return { ok: false, error: "forbidden" };
  await db.message.updateMany({ where: { studentId, senderId: { not: acc.u.id }, readAt: null }, data: { readAt: new Date() } });
  return { ok: true };
}

/** Запрос дополнительного урока или переноса — готовое сообщение учителю. */
export async function requestLesson(text: string): Promise<R> {
  const { s } = await myStudent();
  const r = await sendMessage(s.id, text);
  revalidatePath("/student/messages");
  return r;
}

/** Ответ учителя на вопрос ученика. */
export async function answerQuestion(id: string, text: string): Promise<R> {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  const q = await db.question.findUnique({ where: { id }, include: { student: true } });
  if (!q || q.student.teacherId !== me.id) return { ok: false, error: "not found" };
  const answer = str(text, 4000);
  if (!answer) return { ok: false, error: t("qs.err.empty") };
  await db.question.update({ where: { id }, data: { teacherAnswer: answer, answeredAt: new Date() } });
  if (q.student.userId) await notify({ userId: q.student.userId, kind: "answer", title: `${me.name}: ${answer.slice(0, 100)}`, action: "reply", link: "/student/questions" });
  revalidatePath("/teacher/questions");
  return { ok: true };
}

/** Вопрос ученика вне урока (из раздела «Вопросы»). */
export async function askQuestion(text: string, context: string): Promise<R> {
  const { u, s } = await myStudent();
  const body = str(text, 2000);
  if (!body) return { ok: false, error: "empty" };
  await db.question.create({ data: { studentId: s.id, text: body, context: str(context, 300) || null, askedTeacher: true } });
  await notify({ userId: s.teacherId, kind: "question", title: `${u.name}: ${body.slice(0, 120)}`, action: "reply", link: "/teacher/questions" });
  revalidatePath("/student/questions");
  return { ok: true };
}

// ───────── Слова ─────────

const INTERVAL_DAYS = [0, 1, 3, 7, 21]; // интервальное повторение по уровням 0–4

export async function setWordGoal(goal: number, days: number[], remindAt: string): Promise<R> {
  const { s } = await myStudent();
  await db.student.update({
    where: { id: s.id },
    data: {
      wordGoal: [5, 10, 15, 20].includes(goal) ? goal : 15,
      wordDays: [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort(),
      remindAt: /^\d{2}:\d{2}$/.test(remindAt) ? remindAt : "19:00",
    },
  });
  revalidatePath("/student/words");
  return { ok: true };
}

/** Результат одной карточки тренировки: уровень слова растёт или падает, следующий показ — по интервалу. */
export async function practiceResult(wordId: string, correct: boolean): Promise<R> {
  const { s } = await myStudent();
  const w = await db.word.findUnique({ where: { id: wordId } });
  if (!w || w.studentId !== s.id) return { ok: false, error: "not found" };
  const level = correct ? Math.min(4, w.level + 1) : Math.max(0, w.level - 1);
  await db.word.update({ where: { id: wordId }, data: { level, nextReviewAt: new Date(Date.now() + INTERVAL_DAYS[level] * 864e5) } });
  const day = isoDay(new Date(), s.timezone);
  await db.wordPractice.upsert({ where: { studentId_day: { studentId: s.id, day } }, create: { studentId: s.id, day, count: 1 }, update: { count: { increment: 1 } } });
  return { ok: true };
}

export async function addMyWord(word: string, tr: string, ex: string): Promise<R> {
  const { s } = await myStudent();
  const w = str(word, 120);
  if (!w) return { ok: false, error: "empty" };
  await db.word.create({ data: { studentId: s.id, word: w, translation: str(tr, 200) || null, example: str(ex, 400) || null } });
  revalidatePath("/student/words");
  return { ok: true };
}

export async function updateMyWord(id: string, f: { ownExample?: string; translation?: string }): Promise<R> {
  const { s } = await myStudent();
  const w = await db.word.findUnique({ where: { id } });
  if (!w || w.studentId !== s.id) return { ok: false, error: "not found" };
  await db.word.update({ where: { id }, data: { ownExample: f.ownExample !== undefined ? str(f.ownExample, 400) || null : undefined, translation: f.translation !== undefined ? str(f.translation, 200) || null : undefined } });
  return { ok: true };
}

export async function deleteMyWord(id: string): Promise<R> {
  const { s } = await myStudent();
  const w = await db.word.findUnique({ where: { id } });
  if (!w || w.studentId !== s.id) return { ok: false, error: "not found" };
  await db.word.delete({ where: { id } });
  revalidatePath("/student/words");
  return { ok: true };
}

/** Отметка заметки после урока («Твои заметки» на главной). */
export async function setStudentNote(lessonId: string, text: string): Promise<R> {
  const { s } = await myStudent();
  const l = await db.lessonInstance.findUnique({ where: { id: lessonId } });
  if (!l || l.studentId !== s.id) return { ok: false, error: "not found" };
  await db.lessonInstance.update({ where: { id: lessonId }, data: { studentNote: str(text, 4000) || null } });
  revalidatePath("/student");
  return { ok: true };
}

// ───────── Профиль ─────────

export async function updateMyProfile(f: { name: string; lastName: string; phone: string; telegram: string; timezone: string }): Promise<R> {
  const { t } = await getT();
  const { u, s } = await myStudent();
  const name = str(f.name, 80);
  if (!name) return { ok: false, error: t("auth.err.name") };
  await db.$transaction([
    db.user.update({ where: { id: u.id }, data: { name, lastName: str(f.lastName, 80) || null, phone: str(f.phone, 40) || null, timezone: str(f.timezone, 60) || u.timezone } }),
    db.student.update({ where: { id: s.id }, data: { name, lastName: str(f.lastName, 80) || null, telegram: str(f.telegram, 40) || null, timezone: str(f.timezone, 60) || s.timezone } }),
  ]);
  revalidatePath("/student", "layout");
  return { ok: true };
}

export async function changePassword(oldPw: string, newPw: string): Promise<R> {
  const { t } = await getT();
  const u = await requireUser();
  if (newPw.length < MIN_PASSWORD) return { ok: false, error: t("auth.err.password") };
  if (u.passwordHash && !(await verifyPassword(oldPw, u.passwordHash))) return { ok: false, error: t("prf.err.old") };
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(newPw) } });
  return { ok: true };
}
