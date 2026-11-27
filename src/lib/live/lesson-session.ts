import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { withLock } from "./bus";

export type LessonOccurrence = { startsAt: number; revision: string | null };
export type LessonFinishedEvent = { lessons: { id: string; hasHw: boolean }[] };

type SessionLesson = { startsAt: Date; live: unknown };

export function withLessonLifecycleLock<T>(teacherId: string, lesson: { id: string; slotId: string | null }, run: () => Promise<T>) {
  const key = JSON.stringify([teacherId, lesson.slotId ? "slot" : "lesson", lesson.slotId || lesson.id]);
  return withLock(`lesson-lifecycle:${key}`, run);
}

function sessionState(live: unknown) {
  if (!live || typeof live !== "object" || !("lessonSession" in live)) return null;
  const state = live.lessonSession;
  return state && typeof state === "object" ? state as { revision?: unknown; startedFor?: unknown } : null;
}

export function lessonOccurrence(lesson: SessionLesson): LessonOccurrence {
  const revision = sessionState(lesson.live)?.revision;
  return { startsAt: lesson.startsAt.getTime(), revision: typeof revision === "string" ? revision : null };
}

export function hasStartedLessonSession(lesson: SessionLesson) {
  return sessionState(lesson.live)?.startedFor === lesson.startsAt.getTime();
}

export async function startLessonSession(id: string, teacherId: string, startsAt: Date, revision: string | null) {
  return db.$transaction(async (tx) => {
    const [lesson] = await tx.$queryRaw<{ live: Prisma.JsonValue }[]>`
      SELECT "live" FROM "LessonInstance"
      WHERE "id" = ${id} AND "teacherId" = ${teacherId}
        AND "status" = 'PLANNED' AND "startsAt" = ${startsAt}
        AND ("live" -> 'lessonSession' ->> 'revision') IS NOT DISTINCT FROM ${revision}::text
      FOR UPDATE
    `;
    if (!lesson) return false;
    if (sessionState(lesson.live)?.startedFor === startsAt.getTime()) return true;

    const live = { ...(lesson.live as Prisma.InputJsonObject), lessonSession: { revision, startedFor: startsAt.getTime() } };
    await tx.lessonInstance.update({ where: { id }, data: { live }, select: { id: true } });
    return true;
  });
}

/** A new occurrence invalidates old start actions, even after a move away and back. Call after updating the locked rows. */
export async function invalidateLessonSessions(tx: Prisma.TransactionClient, ids: string[]) {
  const revision = randomUUID();
  const lessons = await tx.lessonInstance.findMany({ where: { id: { in: ids } }, select: { id: true, live: true } });
  for (const lesson of lessons) {
    const live = { ...(lesson.live as Prisma.InputJsonObject), lessonSession: { revision } };
    await tx.lessonInstance.update({ where: { id: lesson.id }, data: { live }, select: { id: true } });
  }
}
