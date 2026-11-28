import "server-only";
import { db } from "../db";
import { readStored } from "../storage";
import { RUB_V2 } from "./rubric";
import { doneOf, json, stateOf } from "./run";
import { readWsAssessment, updateWsAssessment, wsAssessmentSource } from "./ws-assessment";

type Skill = "writing" | "speaking";
type Version = { source: string; generation: number | null; submittedAt: string | null };
type Decision = { type: "confirm"; marks: Record<string, number>; note?: string } | { type: "reopen" };

export const wsTeacherWriteEnabled = () => process.env.PL_WS_TEACHER_WRITE === "1";

async function availableRecordings(state: ReturnType<typeof stateOf>) {
  const item = state.items?.[state.speaking?.id ?? ""];
  if (item?.type !== "speaking") return false;
  const references = item.questions.flatMap((_, index) => {
    const reference = state.speaking?.rec?.[String(index + 1)];
    return reference ? [reference] : [];
  });
  if (!references.length || new Set(references).size !== references.length) return false;
  for (const reference of references) {
    const [key, mime, extra] = reference.split("|");
    if (extra !== undefined || !/^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac)$/.test(mime ?? "")) return false;
    const file = await readStored(key);
    if (!file?.size) return false;
  }
  return true;
}

/** Called with the authenticated teacher's ID. Writes only the chosen skill's review. */
export async function saveWsTeacherDecision(id: string, teacherId: string, kind: Skill, expected: Version, decision: Decision) {
  if (!wsTeacherWriteEnabled()) return "disabled";
  if (kind !== "writing" && kind !== "speaking") return "invalid";
  if (!expected || !decision || (decision.type !== "confirm" && decision.type !== "reopen")) return "invalid";
  if (decision.type === "confirm" && (!decision.marks || typeof decision.marks !== "object" || Array.isArray(decision.marks) ||
    (decision.note !== undefined && (typeof decision.note !== "string" || decision.note.length > 2000)))) return "invalid";

  for (let retry = 0; retry < 3; retry++) {
    const attempt = await db.placementAttempt.findFirst({ where: { id, teacherId } });
    if (!attempt) return "not-found";
    if ((attempt.status !== "submitted" && attempt.status !== "reviewed") ||
      (attempt.submittedAt?.toISOString() ?? null) !== expected.submittedAt) return "stale";

    const state = stateOf(attempt.state);
    const source = wsAssessmentSource(state, kind, RUB_V2);
    const review = attempt.review as Record<string, unknown>;
    const current = readWsAssessment(review, source);
    if (!source.fingerprint || source.fingerprint !== expected.source || current.generation !== expected.generation) return "stale";
    if (!doneOf(state).includes(kind) || !source.hasAnswer) return "empty";

    if (decision.type === "confirm" && kind === "speaking" && !await availableRecordings(state)) return "empty";
    const synced = updateWsAssessment(review, source, { type: "sync" });
    const { generation } = readWsAssessment(synced, source);
    if (generation === null) return "stale";
    const next = updateWsAssessment(synced, source, decision.type === "reopen"
      ? { type: "reopen", generation }
      : {
          type: "confirm", generation,
          confirmation: { teacherId, marks: decision.marks, ...(decision.note?.trim() ? { note: decision.note.trim() } : {}), at: new Date().toISOString() },
        });
    if (next === synced) return "rejected";
    if (!wsTeacherWriteEnabled()) return "disabled";
    const saved = await db.placementAttempt.updateMany({
      where: { id, teacherId, status: attempt.status, updatedAt: attempt.updatedAt, state: { equals: json(attempt.state) }, review: { equals: json(attempt.review) } },
      data: { review: json(next) },
    });
    if (saved.count) return "saved";
  }
  return "stale";
}

export function wsTeacherDecisionView(attempt: { status: string; submittedAt: Date | null; review: unknown; state: unknown }, kind: Skill) {
  if (!wsTeacherWriteEnabled() || (attempt.status !== "submitted" && attempt.status !== "reviewed")) return undefined;
  const state = stateOf(attempt.state);
  const source = wsAssessmentSource(state, kind, RUB_V2);
  if (!source.fingerprint || !doneOf(state).includes(kind)) return undefined;
  const assessment = readWsAssessment(attempt.review as Record<string, unknown>, source);
  return {
    expected: { source: source.fingerprint, generation: assessment.generation, submittedAt: attempt.submittedAt?.toISOString() ?? null },
    hasAnswer: source.hasAnswer,
    confirmed: assessment.confirmation !== null,
    at: assessment.confirmation?.at ?? null,
    draft: assessment.draft?.score.scores ?? null,
  };
}
