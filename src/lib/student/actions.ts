"use server";
import { revalidatePath } from "next/cache";
import { loginOf } from "../auth/cabinet";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { chatAccess } from "./access";
import { getT } from "../i18n/server";
import { searchDictionary } from "../ai/dictionary-lookup";
import { AiError, lookupWordCard, scrub } from "../ai/gateway";
import { wordCardInput } from "../ai/word-card";
import { rateLimit } from "../rate-limit";
import { publish, withLock } from "../live/bus";
import { hashPassword, MIN_PASSWORD, verifyPassword } from "../auth/password";
import { isoDay } from "../time";
import { completeNotes, notify } from "../notify";
import { learningAnswers, patchStudentForm } from "./form";
import { appendWordTranslation, wordTranslations } from "./word-translations";

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
  await completeNotes(acc.u.id, { kind: ["message"], link: acc.u.role === "TEACHER" ? `/teacher/chat?s=${studentId}` : "/student/messages" });
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
  // все вопросы отвечены — уведомления «Ответить» сделаны
  if (!(await db.question.count({ where: { student: { teacherId: me.id }, answeredAt: null } }))) await completeNotes(me.id, { kind: ["question"], link: "/teacher/questions" });
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
  const { u, s } = await myStudent();
  const owner = { userId: u.id };
  await db.$transaction([
    db.student.update({
      where: { id: s.id, ...owner },
      data: {
        wordGoal: [5, 10, 15, 20].includes(goal) ? goal : 15,
        wordDays: [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
        remindAt: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(remindAt) ? remindAt : "19:00",
      },
    }),
    patchStudentForm(s.id, owner, { wordGoalConfigured: true }),
  ]);
  revalidatePath("/student/words");
  revalidatePath("/student/schedule");
  revalidatePath("/student");
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

type ExistingWord = { id: string; word: string; translation: string | null };
type AddWordResult = { status: "added" | "existing" | "updated" | "changed" | "empty" }
  | { status: "confirm"; existing: ExistingWord; value: string };

export async function lookupMyWord(query: string) {
  const { u, s } = await myStudent();
  return searchDictionary(query, {
    userId: u.id,
    teacherId: s.teacherId,
    names: [u.name, u.lastName, s.name, s.lastName],
  });
}

export async function addMyWord(word: string, tr: string, ex: string, confirmation?: Pick<ExistingWord, "id" | "translation">): Promise<AddWordResult> {
  const { s } = await myStudent();
  const clean = (value: unknown, max: number) => str(value, max).replace(/\s+/g, " ").trim();
  const w = clean(word, 120);
  const translation = clean(tr, 200);
  if (!w) return { status: "empty" };

  // The lesson uses the same per-student lock for its read-before-create path.
  const result = await withLock<AddWordResult>(`word:${s.id}`, async () => {
    const matches = await db.$queryRaw<ExistingWord[]>`
      SELECT "id", "word", "translation" FROM "Word"
      WHERE "studentId" = ${s.id}
        AND lower(btrim(regexp_replace("word", '[[:space:]]+', ' ', 'g'))) = lower(${w})
      ORDER BY "createdAt", "id"
    `;
    const existing = matches[0];
    if (!existing) {
      if (confirmation) return { status: "changed" };
      await db.word.create({ data: { studentId: s.id, word: w, translation: translation || null, example: str(ex, 400) || null } });
      return { status: "added" };
    }

    const normalized = translation.toLowerCase();
    const seen = matches.some((match) => wordTranslations(match.translation).some((value) => value.replace(/\s+/g, " ").toLowerCase() === normalized));
    if (!translation || seen) return { status: "existing" };
    if (confirmation?.id !== existing.id || confirmation.translation !== existing.translation) {
      return { status: "confirm", existing, value: translation };
    }

    const { count } = await db.word.updateMany({
      where: { id: existing.id, studentId: s.id, translation: existing.translation },
      data: { translation: appendWordTranslation(existing.translation, translation) },
    });
    return { status: count ? "updated" : "changed" };
  });

  if (result.status === "added" || result.status === "updated") revalidatePath("/student/words");
  return result;
}

/** Дополняет только пустые поля личного слова. IPA остаётся в словарном кэше. */
export async function enrichMyWord(id: string): Promise<
  | { ok: true; definition: string | null; example: string | null; ipa: string | null }
  | { ok: false; error: "not-found" | "limit" | "unavailable" }
> {
  const { u, s } = await myStudent();
  if (typeof id !== "string" || id.length > 100) return { ok: false, error: "not-found" };
  const word = await db.word.findFirst({ where: { id, studentId: s.id } });
  if (!word) return { ok: false, error: "not-found" };

  const input = wordCardInput(word.word, wordTranslations(word.translation)[0]);
  const names = [u.name, u.lastName, s.name, s.lastName];
  if (!input || scrub(input.word, names) !== input.word || scrub(input.translation, names) !== input.translation) {
    return { ok: false, error: "unavailable" };
  }
  if (!(await rateLimit(`word-card:${s.id}`, 20))) return { ok: false, error: "limit" };

  try {
    const details = await lookupWordCard(input, { userId: u.id, teacherId: s.teacherId });
    const where = { id: word.id, studentId: s.id, word: word.word, translation: word.translation };
    const writes = [];
    if (!word.definition?.trim()) {
      writes.push(db.word.updateMany({ where: { ...where, definition: word.definition }, data: { definition: details.definition } }));
    }
    if (!word.example?.trim()) {
      writes.push(db.word.updateMany({ where: { ...where, example: word.example }, data: { example: details.example } }));
    }
    if (writes.length) await db.$transaction(writes);
    const saved = await db.word.findFirst({ where, select: { definition: true, example: true } });
    if (!saved) return { ok: false, error: "unavailable" };
    return { ok: true, ...saved, ipa: details.ipa };
  } catch (error) {
    return { ok: false, error: error instanceof AiError && error.code === "limit" ? "limit" : "unavailable" };
  }
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

export async function updateMyLearningAnswers(_: R | null, f: FormData): Promise<R> {
  const { u, s } = await myStudent();
  const answers = learningAnswers({
    goals: f.getAll("goals"),
    otherGoal: f.get("other"),
    about: f.get("about"),
    since: f.get("since"),
    easy: f.getAll("easy"),
    hard: f.getAll("hard"),
    problem: f.get("problem"),
  });
  const defaults = Object.values(answers).some((answer) => answer.length > 0) ? { filledAt: new Date().toISOString() } : {};
  if (!await patchStudentForm(s.id, { userId: u.id }, answers, defaults)) {
    const { t } = await getT();
    return { ok: false, error: t("tips.formSaveError") };
  }
  revalidatePath("/student");
  revalidatePath("/student/profile");
  revalidatePath(`/teacher/students/${s.id}`);
  return { ok: true };
}

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
  // кабинет учителя на входе ученика: пароль один — меняем пароль входа
  const login = await loginOf(u);
  if (login.passwordHash && !(await verifyPassword(oldPw, login.passwordHash))) return { ok: false, error: t("prf.err.old") };
  await db.user.update({ where: { id: login.id }, data: { passwordHash: await hashPassword(newPw) } });
  return { ok: true };
}

/** Новичок закрыл подсказки «С чего начать» на главной. */
export async function hideTips(): Promise<{ ok: true }> {
  const me = await requireUser("STUDENT");
  await db.student.updateMany({ where: { userId: me.id }, data: { tipsDoneAt: new Date() } });
  revalidatePath("/student");
  return { ok: true };
}
