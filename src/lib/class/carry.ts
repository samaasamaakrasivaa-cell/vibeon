import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "../db";

// Следующее занятие продолжает тот же урок (урок закреплён за учеником), а ответы хранятся по занятию.
// Чтобы работа с прошлого занятия не пропадала, по заданиям раздела «Урок» берём последние ответы этого ученика
// с прошлых занятий того же урока. Пока в текущем занятии ответа нет — показываем их; первое изменение копирует их сюда.
// Домашка — своя у каждого занятия: её не переносим.

type Base = { taskId: string; payload: Prisma.JsonValue; status: string; teacherReview: Prisma.JsonValue | null; lessonInstanceId: string; startsAt: Date };

const nonEmpty = (p: Prisma.JsonValue) => !!p && typeof p === "object" && !Array.isArray(p) && Object.keys(p).length > 0;

/** Последние ответы ученика по заданиям урока с прошлых занятий того же урока (до этого занятия). */
export async function carriedAnswers(o: { lessonIds: string[]; studentId: string; templateId: string; before: Date; taskIds?: string[] }): Promise<Map<string, Base>> {
  const rows = await db.answer.findMany({
    where: {
      studentId: o.studentId, lessonInstanceId: { notIn: o.lessonIds },
      lessonInstance: { templateId: o.templateId, startsAt: { lt: o.before } },
      task: { templateId: o.templateId, section: "lesson" },
      ...(o.taskIds ? { taskId: { in: o.taskIds } } : {}),
    },
    select: { taskId: true, payload: true, status: true, teacherReview: true, lessonInstanceId: true, lessonInstance: { select: { startsAt: true } } },
    orderBy: { lessonInstance: { startsAt: "desc" } },
    take: 2000,
  });
  const out = new Map<string, Base>();
  for (const r of rows) if (!out.has(r.taskId) && nonEmpty(r.payload)) out.set(r.taskId, { taskId: r.taskId, payload: r.payload, status: r.status, teacherReview: r.teacherReview, lessonInstanceId: r.lessonInstanceId, startsAt: r.lessonInstance.startsAt });
  return out;
}

/** Для записи в текущее занятие: ответ с прошлого занятия того же урока, если здесь его ещё нет. */
export async function carriedOne(lessonId: string, studentId: string, taskId: string) {
  const l = await db.lessonInstance.findUnique({ where: { id: lessonId }, select: { templateId: true, startsAt: true } });
  if (!l?.templateId) return null;
  return (await carriedAnswers({ lessonIds: [lessonId], studentId, templateId: l.templateId, before: l.startsAt, taskIds: [taskId] })).get(taskId) ?? null;
}

export const isEmptyPayload = (p: Prisma.JsonValue | null | undefined) => !nonEmpty(p ?? null);
