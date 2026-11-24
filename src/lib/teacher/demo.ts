"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { demoEmail, isDemoEmail, linkedOf } from "../auth/cabinet";
import { randomToken } from "../auth/crypto";
import { switchCabinet } from "../admin/actions";

type R = { ok: true; studentId?: string } | { ok: false; error: string };

/** Тестовый ученик: настоящий кабинет ученика на входе учителя — назначать уроки, домашку, тесты и смотреть, как это видит ученик.
 *  Без своего пароля (вход — через кабинет учителя), цена урока 0 — в финансах не участвует. */
export async function createDemoStudent(): Promise<R> {
  const me = await requireUser("TEACHER");
  const other = await linkedOf(me);
  if (other) {
    if (isDemoEmail(other.email)) { const s = await db.student.findUnique({ where: { userId: other.id }, select: { id: true } }); return { ok: true, studentId: s?.id }; }
    return { ok: false, error: "linked" }; // к входу уже подключён другой кабинет
  }
  const name = "Тестовый", lastName = "ученик";
  const student = await db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: {
      email: demoEmail(randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "")), passwordHash: null, emailVerifiedAt: new Date(),
      name, lastName, role: "STUDENT", lang: me.lang, timezone: me.timezone, consentAt: new Date(), linkedUserId: me.id,
    } });
    await tx.user.update({ where: { id: me.id }, data: { linkedUserId: u.id } });
    return tx.student.create({ data: {
      teacherId: me.id, userId: u.id, name, lastName, status: "ACTIVE", price: 0, billRule: "manual", timezone: me.timezone, startedAt: new Date(),
      privateNote: "Тестовый ученик: ваш собственный кабинет ученика для проверки. Уроки с ним в финансах не учитываются.",
    } });
  });
  revalidatePath("/", "layout");
  return { ok: true, studentId: student.id };
}

/** Удалить тестового ученика (вместе с его уроками и ответами) и отвязать его кабинет. */
export async function deleteDemoStudent(): Promise<R> {
  const me = await requireUser("TEACHER");
  const other = await linkedOf(me);
  if (!other || !isDemoEmail(other.email)) return { ok: false, error: "none" };
  await db.$transaction([
    db.user.update({ where: { id: me.id }, data: { linkedUserId: null } }),
    db.lessonInstance.deleteMany({ where: { student: { userId: other.id } } }),
    db.student.deleteMany({ where: { userId: other.id, teacherId: me.id } }),
    db.user.delete({ where: { id: other.id } }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** «Открыть кабинет ученика» из меню: есть второй кабинет (тестовый или свой ученический) — переходим в него;
 *  нет — сначала создаём тестового ученика. */
export async function openStudentCabinet(): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  const me = await requireUser("TEACHER");
  if (!(await linkedOf(me))) { const r = await createDemoStudent(); if (!r.ok) return r; }
  return switchCabinet();
}
