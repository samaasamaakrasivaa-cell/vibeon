import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { outlineUnitOutcomes, type CourseOutline } from "../tasks/course-outline";
import { cleanInfo } from "../tasks/teacher-info";
import { courseOutlineDraftLifetimeMs, verifyCourseOutlineDraft } from "./course-outline-draft";

const outlineReceiptPrefix = "course-outline-receipt:";

/** Writers of Unit.order take the same course lock before reading positions. */
export function withCourseUnits<T>(courseId: string, teacherId: string, write: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    const course = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Course" WHERE "id" = ${courseId} AND "teacherId" = ${teacherId} FOR NO KEY UPDATE
    `;
    return course.length ? write(tx) : null;
  }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
}

async function nextUnitPosition(tx: Prisma.TransactionClient, courseId: string) {
  const { _max } = await tx.unit.aggregate({ where: { courseId }, _max: { order: true } });
  return (_max.order ?? -1) + 1;
}

export function appendCourseUnit(courseId: string, teacherId: string, title: string) {
  return withCourseUnits(courseId, teacherId, async (tx) => {
    const order = await nextUnitPosition(tx, courseId);
    return tx.unit.create({ data: { courseId, title: title || `Unit ${order + 1}`, order } });
  });
}

export function orderCourseUnits(courseId: string, teacherId: string, ids: string[]) {
  return withCourseUnits(courseId, teacherId, async (tx) => {
    const units = await tx.unit.findMany({
      where: { courseId },
      select: { id: true, order: true },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    });
    const unitsById = new Map(units.map((unit) => [unit.id, unit]));
    const requested = new Set(ids);
    if (requested.size !== ids.length || ids.some((id) => !unitsById.has(id))) return false;

    // A concurrently appended unit can be absent from the teacher's reorder request.
    const ordered = [...ids, ...units.filter((unit) => !requested.has(unit.id)).map((unit) => unit.id)];
    for (const [order, id] of ordered.entries()) {
      if (unitsById.get(id)?.order !== order) await tx.unit.update({ where: { id }, data: { order } });
    }
    return true;
  });
}

export function saveCourseOutlineUnits(courseId: string, teacherId: string, draft: string, plan: CourseOutline) {
  return withCourseUnits(courseId, teacherId, async (tx) => {
    const importId = verifyCourseOutlineDraft(draft, teacherId, courseId);
    if (!importId) return "invalid-draft";
    const receiptKey = outlineReceiptPrefix + importId;
    if (await tx.aiCache.findUnique({ where: { key: receiptKey }, select: { key: true } })) return "saved";

    const firstOrder = await nextUnitPosition(tx, courseId);
    for (const [index, unit] of plan.units.entries()) {
      await tx.unit.create({
        data: {
          courseId,
          title: unit.title,
          order: firstOrder + index,
          outcomes: outlineUnitOutcomes(unit),
          lessons: {
            create: unit.lessons.map((lesson, order) => ({
              title: lesson.title,
              order,
              outcomes: lesson.topics ? [lesson.topics.slice(0, 200)] : [],
              sections: [{ id: randomUUID(), title: "Lead-in" }],
              teacherInfo: cleanInfo({
                info: lesson.topics,
                aims: { grammar: lesson.grammar, vocabulary: lesson.vocabulary, skills: lesson.skills },
              }) as Prisma.InputJsonObject,
            })),
          },
        },
      });
    }
    // Keep a receipt through the replay window, even if the imported units are later deleted.
    await tx.aiCache.deleteMany({
      where: { key: { startsWith: outlineReceiptPrefix }, createdAt: { lt: new Date(Date.now() - courseOutlineDraftLifetimeMs) } },
    });
    await tx.aiCache.create({ data: { key: receiptKey, value: true } });
    return "saved";
  });
}
