import "server-only";
import { createHash } from "node:crypto";
import type { PState } from "./engine";
import { fixWords, parseFixAnswer } from "./fix-answer";
import { storedReport } from "./report-publication";

type Attempt = {
  id: string;
  mode: string;
  track: string;
  teacherId: string;
  studentId: string | null;
  status: string;
  reviewedAt: Date | null;
  showResult: boolean;
  state: PState;
  review: Record<string, unknown>;
};

type Evidence = { itemId: string; source: string };
type CreditEvent = Evidence & {
  id: string;
  proposalId: string;
  action: "confirm" | "revoke";
  teacherId: string;
  reason: string;
  at: string;
};
type CreditHistory = { schema: 1; events: CreditEvent[] };
type Decision = {
  id: string;
  proposal: Evidence & { id: string; attemptId: string };
  action: CreditEvent["action"];
  previousEventId: string | null;
  reason: string;
};

function historyOf(review: Attempt["review"]): CreditHistory | null {
  const value = review.manualCredit as CreditHistory | null | undefined;
  if (value == null) return { schema: 1, events: [] };
  return value.schema === 1 && Array.isArray(value.events) ? value : null;
}

function unpublished(attempt: Attempt) {
  const report = storedReport(attempt.review);
  return attempt.mode === "student" && !!attempt.studentId && attempt.track === "adult" && attempt.status === "submitted" &&
    !attempt.reviewedAt && !attempt.showResult && !attempt.review.tgSentAt &&
    !report.sent && !report.sentAt && !report.legacySendId && !report.resultVisible && !report.publications?.length;
}

/** Identifies the original scored response without copying the answer into the audit history. */
export function manualCreditEvidence(attempt: Attempt, itemId: string): Evidence | null {
  const { state } = attempt;
  const item = state.items?.[itemId], answer = state.answers?.[itemId];
  if (!item || (item.skill !== "grammar" && item.skill !== "vocabulary") || !state.core?.some((step) => step.id === itemId) ||
      !item.q?.trim() || answer?.ok !== false || answer.dk) return null;

  const value = answer.v;
  if (item.type === "mcq") {
    if (typeof value !== "number" || !Number.isInteger(value) || !item.options?.[value] ||
        !Number.isInteger(item.answer) || !item.options[item.answer!]) return null;
  } else {
    if (typeof value !== "string" || !value.trim() || !item.accept?.some((key) => key.trim())) return null;
    if (item.type === "fix") {
      const parsed = parseFixAnswer(value);
      const wordCount = fixWords(item.q).length;
      if (!parsed || parsed.legacy || !parsed.text || parsed.span[1] >= wordCount ||
          !item.span || item.span[0] < 0 || item.span[1] < item.span[0] || item.span[1] >= wordCount) return null;
    }
  }
  const source = createHash("sha256").update(JSON.stringify([
    attempt.id, itemId, item.skill, item.topic_id, item.type, item.q, item.options, item.answer, item.accept,
    item.base, item.key, item.frame, item.instruction_en, item.span, item.wrong, value, answer.ok,
  ])).digest("hex");
  return { itemId, source };
}

function lastDecision(history: CreditHistory, evidence: Evidence) {
  return history.events.findLast((event) => event.itemId === evidence.itemId && event.source === evidence.source);
}

export function manualCreditScore(attempt: Attempt, itemId: string) {
  const original = attempt.state.answers?.[itemId]?.ok ?? null;
  const evidence = manualCreditEvidence(attempt, itemId);
  const history = historyOf(attempt.review);
  const decision = evidence && history ? lastDecision(history, evidence) ?? null : null;
  return { original, effective: decision?.action === "confirm" && unpublished(attempt) ? true : original, decision };
}

/** The caller supplies an authenticated actor, a vetted proposal and the fresh attempt. */
export function decideManualCredit(attempt: Attempt, actor: { id: string; role: string }, decision: Decision, now: Date) {
  const review = attempt.review;
  if (actor.role !== "TEACHER" || actor.id !== attempt.teacherId || !unpublished(attempt)) return review;
  const { proposal } = decision;
  const history = historyOf(review);
  const evidence = manualCreditEvidence(attempt, proposal.itemId);
  const reason = decision.reason.trim();
  if (!history || !evidence || evidence.source !== proposal.source || proposal.attemptId !== attempt.id ||
      !proposal.id || !decision.id || !reason || reason.length > 1000 || history.events.some((event) => event.id === decision.id)) return review;

  const previous = lastDecision(history, evidence);
  if ((previous?.id ?? null) !== decision.previousEventId) return review;
  if (decision.action === "confirm" ? previous?.action === "confirm" : previous?.action !== "confirm" || previous.proposalId !== proposal.id) return review;

  const event: CreditEvent = {
    ...evidence, id: decision.id, proposalId: proposal.id, action: decision.action, teacherId: actor.id, reason, at: now.toISOString(),
  };
  return { ...review, manualCredit: { ...history, events: [...history.events, event] } };
}
