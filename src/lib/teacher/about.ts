"use server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { cleanAbout, type TeacherAbout } from "./about-data";

/** Сохранить анкету преподавателя (видят его ученики). */
export async function saveTeacherAbout(x: TeacherAbout): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser("TEACHER");
  const about = cleanAbout(x);
  await db.teacherProfile.update({ where: { userId: me.id }, data: { about: about as Prisma.InputJsonObject } });
  revalidatePath("/teacher/profile"); revalidatePath("/student/teacher");
  return { ok: true };
}
