import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { GOALS, SINCE, SKILLS } from "../onboarding";

export function studentForm(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

function selections(values: unknown, choices: [string, string][]) {
  return Array.isArray(values) ? choices.map(([value]) => value).filter((value) => values.includes(value)) : [];
}

export function learningAnswers(value: unknown) {
  const form = studentForm(value);
  return {
    goals: selections(form.goals, GOALS),
    otherGoal: text(form.otherGoal),
    about: text(form.about),
    since: selections([form.since], SINCE)[0] ?? "",
    easy: selections(form.easy, SKILLS),
    hard: selections(form.hard, SKILLS),
    problem: text(form.problem),
  };
}

export type LearningAnswers = ReturnType<typeof learningAnswers>;

/** Merge only the caller's fields so concurrent profile edits preserve each other's answers. */
export function patchStudentForm(
  id: string,
  owner: { userId: string } | { teacherId: string },
  patch: Prisma.InputJsonObject,
  defaults: Prisma.InputJsonObject = {},
) {
  const ownership = "userId" in owner ? Prisma.sql`"userId" = ${owner.userId}` : Prisma.sql`"teacherId" = ${owner.teacherId}`;
  return db.$executeRaw`
    UPDATE "Student"
    SET "form" = ${JSON.stringify(defaults)}::jsonb
                 || (CASE WHEN jsonb_typeof("form") = 'object' THEN "form" ELSE '{}'::jsonb END)
                 || ${JSON.stringify(patch)}::jsonb,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id} AND ${ownership}
  `;
}
