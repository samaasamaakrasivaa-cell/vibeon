import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { lessonAnalysisAvailable, lessonAnalysisChat } from "../ai/gateway";
import { LESSON_ANALYSIS_MODEL, LESSON_ANALYSIS_MONTHLY_LIMIT, lessonAnalysisInput, localPractice, type Practice } from "../ai/lesson-analysis-plan";
import { lessonModelEvidence, lessonTaskEvidence, type LessonTaskEvidence } from "./analysis-facts";
import { observationFocus, type ObservationFocus } from "./observation-focus";

const RESERVATION_KIND = "lesson-analysis-reservation";
const GENERATION_WINDOW = 60_000;
const key = "lessonAnalysisV1";
const observationKey = "lessonObservationV1";
export const LESSON_OBSERVATION_MAX = 600;

export type LessonAnalysis = {
  state: "draft" | "private" | "published";
  teacherId: string;
  studentId: string;
  startsAt: string;
  finishedAt: string | null;
  tasks: LessonTaskEvidence[];
  practice: Practice[];
  source: "local" | "ai";
  pendingUntil: number | null;
  focus?: ObservationFocus | null;
};

type Client = Prisma.TransactionClient;
type LessonBinding = { teacherId: string | null; studentId: string | null; startsAt: Date; finishedAt: Date | null };
type BoundLesson = { teacherId: string; studentId: string; startsAt: string; finishedAt: string | null };
type LessonObservation = BoundLesson & { note: string; focus: ObservationFocus | null };

function matchesLesson(bound: BoundLesson, lesson: LessonBinding) {
  return bound.teacherId === lesson.teacherId && bound.studentId === lesson.studentId &&
    bound.startsAt === lesson.startsAt.toISOString() && bound.finishedAt === (lesson.finishedAt?.toISOString() ?? null);
}

function readAnalysis(notes: unknown, lesson: LessonBinding): LessonAnalysis | null {
  const report = (notes as { lessonAnalysisV1?: LessonAnalysis } | null)?.lessonAnalysisV1;
  return report && matchesLesson(report, lesson) ? report : null;
}

function readObservation(notes: unknown, lesson: LessonBinding) {
  const observation = (notes as { lessonObservationV1?: LessonObservation } | null)?.lessonObservationV1;
  if (!observation || !matchesLesson(observation, lesson) || typeof observation.note !== "string") return null;
  return { note: observation.note, focus: observationFocus(observation.focus) };
}

export const analysisPending = (report: LessonAnalysis) => (report.pendingUntil ?? 0) > Date.now();

function teacherLesson(client: Client, id: string, teacherId: string) {
  return client.lessonInstance.findFirst({
    where: { id, teacherId, status: "DONE", student: { teacherId, teacher: { blockedAt: null } } },
    select: { id: true, teacherId: true, studentId: true, slotId: true, startsAt: true, finishedAt: true, templateId: true, live: true,
      student: { select: { id: true, name: true, lastName: true } } },
  });
}

async function snapshot(client: Client, id: string, studentId: string) {
  return client.lessonSummary.findUnique({
    where: { lessonInstanceId_studentId: { lessonInstanceId: id, studentId } }, select: { notes: true },
  });
}

async function evidenceFor(client: Client, lesson: { id: string; studentId: string; templateId: string | null; slotId: string | null; teacherId: string | null; live: unknown }) {
  if (!lesson.templateId) return [];
  const host = lesson.slotId && await client.lessonInstance.findFirst({ where: { slotId: lesson.slotId, teacherId: lesson.teacherId },
    orderBy: { id: "asc" }, select: { live: true } });
  const hidden = (host ? host.live : lesson.live) as { hidden?: string[] } | null;
  const answers = await client.answer.findMany({
    where: { lessonInstanceId: lesson.id, studentId: lesson.studentId,
      task: { templateId: lesson.templateId, section: "lesson", hidden: false, ...(Array.isArray(hidden?.hidden) ? { id: { notIn: hidden.hidden } } : {}) } },
    select: { taskId: true, payload: true, lessonMs: true, hwMs: true, task: { select: { id: true, type: true, title: true, content: true, section: true, options: true } } },
    orderBy: [{ task: { order: "asc" } }, { taskId: "asc" }],
  });
  return lessonTaskEvidence(answers.map((row) => row.task), answers);
}

export async function teacherLessonAnalysis(id: string, teacherId: string) {
  const lesson = await teacherLesson(db, id, teacherId);
  if (!lesson?.student || !lesson.studentId) return null;
  const stored = await snapshot(db, id, lesson.studentId);
  const report = readAnalysis(stored?.notes, lesson);
  const observation = readObservation(stored?.notes, lesson);
  const tasks = report?.tasks ?? await evidenceFor(db, { ...lesson, studentId: lesson.studentId });
  const participants = lesson.slotId ? await db.lessonInstance.findMany({
    where: { slotId: lesson.slotId, teacherId, status: "DONE", student: { teacherId } },
    select: { id: true, student: { select: { name: true, lastName: true } } }, orderBy: { id: "asc" },
  }) : [];
  return { lesson, report, observation, tasks, participants, canCallAi: lessonAnalysisAvailable() && lessonModelEvidence(tasks).length > 0 };
}

async function withTeacherLesson<T>(id: string, teacherId: string, act: (client: Client,
  lesson: NonNullable<Awaited<ReturnType<typeof teacherLesson>>> & { studentId: string }) => Promise<T>) {
  return db.$transaction(async (client) => {
    const [locked] = await client.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "LessonInstance" WHERE "id" = ${id} AND "teacherId" = ${teacherId} FOR UPDATE
    `;
    if (!locked) return null;
    const lesson = await teacherLesson(client, id, teacherId);
    if (!lesson?.studentId) return null;
    return act(client, { ...lesson, studentId: lesson.studentId });
  });
}

async function saveLessonNotes(client: Client, lessonId: string, studentId: string, value: object) {
  const notes = JSON.stringify(value);
  await client.$executeRaw`
    INSERT INTO "LessonSummary" ("id", "lessonInstanceId", "studentId", "notes", "status", "updatedAt")
    VALUES (${randomUUID()}, ${lessonId}, ${studentId}, ${notes}::jsonb, 'analysis-only', CURRENT_TIMESTAMP)
    ON CONFLICT ("lessonInstanceId", "studentId") DO UPDATE SET
      "notes" = "LessonSummary"."notes" || EXCLUDED."notes"
  `;
}

function saveAnalysis(client: Client, lessonId: string, report: LessonAnalysis) {
  return saveLessonNotes(client, lessonId, report.studentId, { [key]: report });
}

type ObservationInput = { text: unknown; selected: unknown };

function deleteLessonNote(client: Client, id: string, studentId: string, field: string) {
  return client.$executeRaw`
    UPDATE "LessonSummary" SET "notes" = "notes" - ${field}::text
    WHERE "lessonInstanceId" = ${id} AND "studentId" = ${studentId} AND "notes" ? ${field}::text
  `;
}

async function writeObservation(client: Client, lesson: LessonBinding & { id: string; studentId: string }, teacherId: string,
  { text, selected }: ObservationInput) {
  const note = typeof text === "string" ? text.toWellFormed().replace(/\u0000/g, "").trim().slice(0, LESSON_OBSERVATION_MAX).toWellFormed() : "";
  const focus = observationFocus(selected);
  if (!note && !focus) {
    return deleteLessonNote(client, lesson.id, lesson.studentId, observationKey);
  }
  const observation: LessonObservation = { note, focus, teacherId, studentId: lesson.studentId,
    startsAt: lesson.startsAt.toISOString(), finishedAt: lesson.finishedAt?.toISOString() ?? null };
  await saveLessonNotes(client, lesson.id, lesson.studentId, { [observationKey]: observation });
}

export async function saveLessonObservation(id: string, teacherId: string, input: ObservationInput) {
  return withTeacherLesson(id, teacherId, async (client, lesson) => {
    await writeObservation(client, lesson, teacherId, input);
    const stored = await snapshot(client, id, lesson.studentId);
    const report = readAnalysis(stored?.notes, lesson);
    const focus = observationFocus(input.selected);
    if (report?.state === "draft" && (report.focus ?? null) !== focus) {
      if (report.tasks.length || focus) await saveAnalysis(client, id, { ...report, focus });
      else await deleteLessonNote(client, id, lesson.studentId, key);
    }
    return lesson.studentId;
  });
}

export async function lessonCheckpointFocus(studentId: string, teacherId: string, since: Date) {
  const rows = await db.lessonSummary.findMany({
    where: { studentId, notes: { path: [observationKey, "note"], string_contains: "" },
      lessonInstance: { status: "DONE", studentId, teacherId, startsAt: { gte: since }, student: { teacherId, teacher: { blockedAt: null } } } },
    select: { notes: true, lessonInstance: { select: { id: true, startsAt: true, finishedAt: true, teacherId: true, studentId: true } } },
    orderBy: [{ lessonInstance: { startsAt: "desc" } }, { lessonInstanceId: "desc" }], take: 50,
  });
  const byFocus = new Map<ObservationFocus | null, string>();
  for (const row of rows) {
    const observation = readObservation(row.notes, row.lessonInstance);
    if (observation && !byFocus.has(observation.focus)) byFocus.set(observation.focus, row.lessonInstance.id);
  }
  return Array.from(byFocus, ([focus, lessonId]) => ({ focus, lessonId })).slice(0, 5);
}

async function reserve(client: Client, id: string, teacherId: string) {
  // Serialize only the database reservation across app instances, with no network calls under the lock.
  await client.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(791437169)`;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const token = `lesson-analysis:${createHash("sha256").update(id).digest("hex")}`;
  if (await client.aiCall.findUnique({ where: { id: token }, select: { id: true } })) return null;
  const calls = await client.aiCall.count({ where: { kind: RESERVATION_KIND, createdAt: { gte: start } } });
  if (calls >= LESSON_ANALYSIS_MONTHLY_LIMIT) return null;
  await client.aiCall.create({ data: { id: token, teacherId, userId: teacherId, kind: RESERVATION_KIND,
    provider: "yandex", model: LESSON_ANALYSIS_MODEL, ok: false, createdAt: now } });
  return token;
}

export async function generateLessonAnalysis(id: string, teacherId: string, allowAi: boolean, observation?: ObservationInput) {
  const attempt = await withTeacherLesson(id, teacherId, async (client, lesson) => {
    const previous = await snapshot(client, id, lesson.studentId);
    if (readAnalysis(previous?.notes, lesson)) return null;
    if (observation) await writeObservation(client, lesson, teacherId, observation);
    const tasks = await evidenceFor(client, lesson);
    const focus = observation ? observationFocus(observation.selected) : readObservation(previous?.notes, lesson)?.focus;
    if (!tasks.length && !focus) return null;
    const evidence = lessonModelEvidence(tasks);
    const token = allowAi && evidence.length && lessonAnalysisAvailable() ? await reserve(client, id, teacherId) : null;
    const report: LessonAnalysis = { state: "draft", teacherId, studentId: lesson.studentId,
      startsAt: lesson.startsAt.toISOString(), finishedAt: lesson.finishedAt?.toISOString() ?? null, tasks,
      practice: localPractice(evidence), source: "local", pendingUntil: token ? Date.now() + GENERATION_WINDOW : null,
      ...(focus ? { focus } : {}) };
    await saveAnalysis(client, id, report);
    return { token, report, input: lessonAnalysisInput(evidence) };
  });
  if (!attempt?.token) return;

  const practice = await lessonAnalysisChat(attempt.input, attempt.token, { teacherId, userId: teacherId }).catch(() => null);
  await withTeacherLesson(id, teacherId, async (client, lesson) => {
    const stored = await snapshot(client, id, lesson.studentId);
    const report = readAnalysis(stored?.notes, lesson);
    if (!report || report.state !== "draft" || report.pendingUntil !== attempt.report.pendingUntil) return;
    await saveAnalysis(client, id, { ...report, pendingUntil: null,
      ...(practice && analysisPending(report) ? { practice, source: "ai" } : {}) });
  });
}

export async function approveLessonAnalysis(id: string, teacherId: string, publish: boolean) {
  return withTeacherLesson(id, teacherId, async (client, lesson) => {
    const stored = await snapshot(client, id, lesson.studentId);
    const report = readAnalysis(stored?.notes, lesson);
    if (!report || report.state === "published" || analysisPending(report)) return false;
    await saveAnalysis(client, id, { ...report, state: publish ? "published" : "private", pendingUntil: null });
    return true;
  });
}

function publishedReports(userId: string) {
  return Prisma.sql`
    FROM "LessonInstance" l
    JOIN "Student" s ON s."id" = l."studentId"
    JOIN "LessonSummary" ls ON ls."lessonInstanceId" = l.id AND ls."studentId" = s.id
    CROSS JOIN LATERAL (SELECT ls."notes" -> ${key}::text AS report) AS r
    WHERE s."userId" = ${userId} AND l.status = 'DONE' AND r.report ->> 'state' = 'published'
      AND r.report ->> 'studentId' = l."studentId" AND r.report ->> 'teacherId' = l."teacherId"
      AND r.report ->> 'startsAt' = to_char(l."startsAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      AND r.report ->> 'finishedAt' IS NOT DISTINCT FROM to_char(l."finishedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  `;
}

export async function publishedLessonAnalysis(id: string, userId: string) {
  const [report] = await db.$queryRaw<{
    date: Date; tasks: Omit<LessonTaskEvidence, "title" | "topicName">[]; practice: Practice[]; focus: unknown;
  }[]>`
    SELECT l."startsAt" AS date, r.report -> 'practice' AS practice, r.report ->> 'focus' AS focus,
      COALESCE((SELECT jsonb_agg(task - 'title' - 'topicName' ORDER BY position)
        FROM jsonb_array_elements(r.report -> 'tasks') WITH ORDINALITY AS items(task, position)), '[]'::jsonb) AS tasks
    ${publishedReports(userId)} AND l.id = ${id}
  `;
  if (!report) return null;
  const tasks = report.tasks.map((task) => ({ ...task, title: "", topicName: null }));
  return { date: report.date, tasks, practice: report.practice, focus: observationFocus(report.focus) };
}

export function recentPublishedAnalysis(studentId: string, userId: string) {
  return db.$queryRaw<{ id: string; date: Date }[]>`
    SELECT l.id, l."startsAt" AS date ${publishedReports(userId)} AND s.id = ${studentId}
    ORDER BY l."startsAt" DESC, l.id DESC LIMIT 5
  `;
}
