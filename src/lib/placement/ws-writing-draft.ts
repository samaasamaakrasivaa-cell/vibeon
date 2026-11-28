import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { PlacementScore, ScoreInput } from "./ai-feedback";
import { PL_LEVELS } from "./engine";
import { describe5, RUB_V2 } from "./rubric";
import { doneOf, json, stateOf } from "./run";
import { readWsAssessment, updateWsAssessment, wsAssessmentSource } from "./ws-assessment";
import { wsTeacherWriteEnabled } from "./ws-teacher-write";

type Version = { source: string; generation: number | null; submittedAt: string | null; requestSequence: number | null };
type Transition = Parameters<typeof updateWsAssessment>[2];

function scoreInput(state: ReturnType<typeof stateOf>): ScoreInput | null {
  const item = state.items?.[state.writing?.id ?? ""];
  if (item?.type !== "writing" || !state.writing?.text.trim()) return null;
  const { level } = item;
  const below = PL_LEVELS[PL_LEVELS.indexOf(level) - 1] ?? "";
  return {
    kind: "writing", level, below, teen: state.track === "teen",
    task: `${item.prompt_en}\n${(item.points ?? []).join("\n")}\n(${item.min_words}–${item.max_words} words)`,
    answers: [state.writing.text], max: RUB_V2.max,
    criteria: RUB_V2.writing.map((criterion) => ({
      id: criterion.id, name: criterion.name_ru, en: criterion.en, level: criterion.levels?.[level] ?? "",
      below: below ? criterion.levels?.[below] ?? "" : "",
      bands: [5, 4, 3, 2, 1, 0].map((value) => `${value} — ${describe5(criterion, level, value)}`),
    })),
  };
}

/** The model runs after the request is stored. Every result is checked on a fresh attempt. */
export async function requestWsWritingDraft(id: string, teacherId: string, expected: Version, score: (input: ScoreInput, names: (string | null | undefined)[]) => Promise<PlacementScore>) {
  if (!expected) return "stale";
  const requestId = randomUUID();

  async function apply(transition?: Transition) {
    for (let retry = 0; retry < 3; retry++) {
      if (!wsTeacherWriteEnabled()) return null;
      const attempt = await db.placementAttempt.findFirst({ where: { id, teacherId }, include: { student: { select: { name: true, lastName: true } } } });
      if (!attempt || (attempt.status !== "submitted" && attempt.status !== "reviewed") ||
          (attempt.submittedAt?.toISOString() ?? null) !== expected.submittedAt) return null;
      const state = stateOf(attempt.state);
      const source = wsAssessmentSource(state, "writing", RUB_V2);
      if (!source.hasAnswer || !source.fingerprint || source.fingerprint !== expected.source || !doneOf(state).includes("writing")) return null;
      const review = (attempt.review ?? {}) as Record<string, unknown>;
      const current = readWsAssessment(review, source);
      if (!transition && (current.generation !== expected.generation || (current.request?.sequence ?? null) !== expected.requestSequence)) return null;

      const synced = transition ? review : updateWsAssessment(review, source, { type: "sync" });
      const { generation } = readWsAssessment(synced, source);
      const input = scoreInput(state);
      if (generation === null || !input) return null;
      const next = updateWsAssessment(synced, source, transition ?? {
        type: "request", generation, previousSequence: expected.requestSequence, id: requestId,
      });
      if (next === synced || !wsTeacherWriteEnabled()) return null;
      const saved = await db.placementAttempt.updateMany({
        where: { id, teacherId, status: attempt.status, updatedAt: attempt.updatedAt, state: { equals: json(attempt.state) }, review: { equals: json(attempt.review) } },
        data: { review: json(next) },
      });
      if (saved.count) return { input, generation, names: [attempt.student?.name, attempt.student?.lastName, attempt.guestName], sequence: (expected.requestSequence ?? 0) + 1 };
    }
    return null;
  }

  const start = await apply();
  if (!start) return "stale";
  const run = { generation: start.generation, sequence: start.sequence, id: requestId };
  let result: PlacementScore;
  try {
    result = await score(start.input, start.names);
  } catch {
    return await apply({ type: "failure", ...run }) ? "failed" : "stale";
  }
  return await apply({ type: "result", ...run, score: result, at: new Date().toISOString() }) ? "saved" : "stale";
}
