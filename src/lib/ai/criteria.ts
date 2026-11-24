import "server-only";
import { db } from "../db";

/** Критерии ОГЭ / ЕГЭ учителя (текст ФИПИ) — передаются в проверку как exam_criteria. */
export type ExamCriteria = { oge?: string; ege?: string };

export async function teacherCriteria(teacherId: string): Promise<ExamCriteria> {
  const prof = await db.teacherProfile.findUnique({ where: { userId: teacherId }, select: { settings: true } });
  return ((prof?.settings ?? {}) as { examCriteria?: ExamCriteria }).examCriteria ?? {};
}
