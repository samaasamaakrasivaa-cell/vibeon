"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/session";

type R = { ok: true } | { ok: false; error: string };

/** Своё событие ученика: «съездила в Италию — спросить про поездку». */
export async function addStudentEvent(studentId: string, day: string, text: string): Promise<R> {
  const me = await requireUser("TEACHER");
  const s = await db.student.findUnique({ where: { id: studentId }, select: { teacherId: true } });
  if (!s || s.teacherId !== me.id) return { ok: false, error: "nf" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "date" };
  const t = text.trim().slice(0, 300);
  if (!t) return { ok: false, error: "text" };
  await db.studentEvent.create({ data: { teacherId: me.id, studentId, day, text: t } });
  revalidatePath("/teacher");
  return { ok: true };
}

/** «Готово» — событие обсудили, из блока пропадает; delete — удалить совсем. */
export async function closeStudentEvent(id: string, remove = false): Promise<R> {
  const me = await requireUser("TEACHER");
  if (remove) await db.studentEvent.deleteMany({ where: { id, teacherId: me.id } });
  else await db.studentEvent.updateMany({ where: { id, teacherId: me.id }, data: { doneAt: new Date() } });
  revalidatePath("/teacher");
  return { ok: true };
}
