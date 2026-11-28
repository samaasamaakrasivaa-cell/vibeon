import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";

export type VocabularyStats = {
  students: number;
  words: number;
  linked: number;
  unlinked: number;
  practiced: number;
  lastPracticeDay: string | null;
  lastAddedAt: Date | null;
};

/**
 * Read-only summary. The teacher ID must come from requireUser("TEACHER").
 * An absent studentId means the teacher's active students; an explicit ID
 * means that student's card (including archive), still scoped to the teacher.
 * WordPractice counts processed cards, not sessions or unique words.
 */
export async function teacherVocabularyStats(teacherId: string, studentId?: string): Promise<VocabularyStats | null> {
  const scope: Prisma.StudentWhereInput = studentId === undefined
    ? { teacherId, status: "ACTIVE" }
    : { teacherId, id: studentId };
  return db.$transaction(async (tx) => {
    const students = await tx.student.count({ where: scope });
    if (studentId !== undefined && students !== 1) return null;
    const [word, linked, practice] = await Promise.all([
      tx.word.aggregate({ where: { student: scope }, _count: { _all: true }, _max: { createdAt: true } }),
      tx.word.count({
        where: {
          student: scope,
          AND: [{ sourceLessonId: { not: null } }, { sourceLessonId: { not: "" } }],
        },
      }),
      tx.wordPractice.aggregate({
        where: { student: scope, count: { gt: 0 } },
        _sum: { count: true },
        _max: { day: true },
      }),
    ]);
    return {
      students,
      words: word._count._all,
      linked,
      unlinked: word._count._all - linked,
      practiced: practice._sum.count ?? 0,
      lastPracticeDay: practice._max.day,
      lastAddedAt: word._max.createdAt,
    };
  }, { isolationLevel: "RepeatableRead" });
}
