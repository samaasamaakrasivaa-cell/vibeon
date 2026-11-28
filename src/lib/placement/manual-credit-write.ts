import "server-only";
import { db } from "../db";
import { decideManualCredit } from "./manual-credit";
import { json, stateOf } from "./run";

/** Receives the authenticated actor and a server-vetted proposal. The review screen is wired separately. */
export async function writeManualCredit(
  attemptId: string,
  actor: Parameters<typeof decideManualCredit>[1],
  decision: Parameters<typeof decideManualCredit>[2],
) {
  if (actor.role !== "TEACHER" || !decision || (decision.action !== "confirm" && decision.action !== "revoke") ||
      typeof decision.reason !== "string" || !decision.proposal) return "rejected";

  for (let retry = 0; retry < 3; retry++) {
    const attempt = await db.placementAttempt.findFirst({ where: { id: attemptId, teacherId: actor.id } });
    if (!attempt) return "not-found";
    const review = (attempt.review ?? {}) as Record<string, unknown>;
    const next = decideManualCredit({ ...attempt, state: stateOf(attempt.state), review }, actor, decision, new Date());
    if (review === next) return "rejected";

    const saved = await db.placementAttempt.updateMany({
      where: {
        id: attemptId, teacherId: actor.id, status: "submitted", reviewedAt: null, showResult: false,
        updatedAt: attempt.updatedAt, state: { equals: json(attempt.state) }, review: { equals: json(attempt.review) },
      },
      data: { review: json(next) },
    });
    if (saved.count) return "saved";
  }
  return "stale";
}
