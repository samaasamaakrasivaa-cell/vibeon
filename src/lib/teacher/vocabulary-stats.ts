import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { addDaysIso, isoDay } from "../time";

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

export type StudentVocabularyActivity = {
  id: string;
  name: string;
  lastName: string | null;
  cards: number;
  learned: number;
  lastPracticeDay: string | null;
  practiceDays: { day: string; count: number }[];
};

/** Practice days use the student's calendar, just as practiceResult records them. */
export async function activeTeacherVocabulary(teacherId: string, now = new Date()): Promise<StudentVocabularyActivity[]> {
  const scope = { teacherId, status: "ACTIVE" } as const;
  return db.$transaction(async (tx) => {
    const students = await tx.student.findMany({
      where: scope,
      orderBy: [{ name: "asc" }, { lastName: "asc" }, { id: "asc" }],
      select: { id: true, name: true, lastName: true, timezone: true },
    });
    if (students.length === 0) return [];

    const windows = students.map(({ id, name, lastName, timezone }) => {
      const today = isoDay(now, timezone);
      const days = Array.from({ length: 14 }, (_, i) => addDaysIso(today, i - 13));
      return { id, name, lastName, days };
    });
    const firstDay = windows.map(({ days }) => days[0]).sort()[0];
    const lastDay = windows.map(({ days }) => days[13]).sort().at(-1)!;
    const [wordGroups, latestPractice, practice] = await Promise.all([
      tx.word.groupBy({ by: ["studentId", "level"], where: { student: scope }, _count: { _all: true } }),
      tx.wordPractice.groupBy({ by: ["studentId"], where: { student: scope, count: { gt: 0 } }, _max: { day: true } }),
      tx.wordPractice.findMany({
        where: { student: scope, day: { gte: firstDay, lte: lastDay }, count: { gt: 0 } },
        select: { studentId: true, day: true, count: true },
      }),
    ]);
    const wordsByStudent = new Map<string, { cards: number; learned: number }>();
    for (const { studentId, level, _count } of wordGroups) {
      const stats = wordsByStudent.get(studentId) ?? { cards: 0, learned: 0 };
      stats.cards += _count._all;
      if (level >= 4) stats.learned += _count._all;
      wordsByStudent.set(studentId, stats);
    }
    const latestByStudent = new Map(latestPractice.map(({ studentId, _max }) => [studentId, _max.day]));
    const practiceByDay = new Map(practice.map(({ studentId, day, count }) => [`${studentId}:${day}`, count]));

    return windows.map(({ id, name, lastName, days }) => ({
      id, name, lastName,
      ...(wordsByStudent.get(id) ?? { cards: 0, learned: 0 }),
      lastPracticeDay: latestByStudent.get(id) ?? null,
      practiceDays: days.map((day) => ({ day, count: practiceByDay.get(`${id}:${day}`) ?? 0 })),
    }));
  }, { isolationLevel: "RepeatableRead" });
}
