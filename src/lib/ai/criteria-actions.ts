"use server";
// Настройки учителя → «Критерии ОГЭ и ЕГЭ для ИИ-проверки»: текст критериев ФИПИ (меняются каждый год).
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireUser } from "../auth/session";
import { aiCtx } from "./ctx";
import { extractable, extractText, EXTRACT_MAX } from "./extract";

const MAX = 20000;

export async function saveExamCriteria(v: { oge: string; ege: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser("TEACHER");
  const prof = await db.teacherProfile.findUnique({ where: { userId: me.id }, select: { settings: true } });
  const settings = { ...((prof?.settings ?? {}) as Record<string, unknown>), examCriteria: { oge: String(v.oge ?? "").trim().slice(0, MAX), ege: String(v.ege ?? "").trim().slice(0, MAX), at: new Date().toISOString() } };
  await db.teacherProfile.upsert({ where: { userId: me.id }, create: { userId: me.id, settings: settings as Prisma.InputJsonObject }, update: { settings: settings as Prisma.InputJsonObject } });
  revalidatePath("/teacher/profile");
  return { ok: true };
}

/** Файл с критериями (Word, PDF, текст) → текст в поле; сохраняет учитель кнопкой. */
export async function readCriteriaFile(fd: FormData): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const me = await requireUser("TEACHER");
  const f = fd.get("file");
  if (!(f instanceof File) || !f.size) return { ok: false, error: "file" };
  if (f.size > EXTRACT_MAX || !extractable(f.name, f.type)) return { ok: false, error: "type" };
  try {
    const r = await extractText(Buffer.from(await f.arrayBuffer()), f.name, f.type, await aiCtx(me));
    return r.text.trim() ? { ok: true, text: r.text.trim().slice(0, MAX) } : { ok: false, error: "empty" };
  } catch { return { ok: false, error: "fail" }; }
}
