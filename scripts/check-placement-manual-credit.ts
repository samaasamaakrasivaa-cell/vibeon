import assert from "node:assert/strict";
import { checkCore, emptyState, type CoreItem } from "../src/lib/placement/engine";
import { decideManualCredit, manualCreditEvidence, manualCreditScore } from "../src/lib/placement/manual-credit";

const task: CoreItem = {
  id: "fixture-1", topic_id: "present", topic_en: "Present", topic_ru: "Настоящее", level: "B1", band: 0,
  type: "gap", skill: "grammar", q: "She ___ the bus every day.", accept: ["takes"], explain_ru: "",
};
const state = {
  ...emptyState(), section: "done" as const, items: { [task.id]: task }, core: [{ id: task.id, step: 4 }],
  answers: { [task.id]: { v: "catches", ok: false, ms: 1400, cf: 1 as const } },
};
const originalReview = { writing: { task: 2 }, report: { draft: { student: { lang: "en" } } } };
const attempt = {
  id: "fixture-attempt", teacherId: "teacher", studentId: "student", mode: "student", track: "adult",
  status: "submitted", reviewedAt: null, showResult: false, review: originalReview, state,
};
const evidence = manualCreditEvidence(attempt, task.id)!;
assert.ok(evidence);
assert.equal(checkCore(task, state.answers[task.id].v), false);
assert.equal(checkCore({ ...task, accept: ["takes", "catches"] }, state.answers[task.id].v), true);
const proposal = { ...evidence, id: "fixture-proposal-A", attemptId: attempt.id };
const teacher = { id: "teacher", role: "TEACHER" };
const at = new Date("2026-11-28T09:00:00Z");
const confirm = { id: "decision-1", proposal, action: "confirm", previousEventId: null, reason: " Both verbs fit this sentence. " } as const;

assert.equal(decideManualCredit(attempt, { ...teacher, id: "other" }, confirm, at), originalReview);
assert.equal(decideManualCredit(attempt, { ...teacher, role: "STUDENT" }, confirm, at), originalReview);
assert.equal(decideManualCredit({ ...attempt, id: "other-attempt" }, teacher, confirm, at), originalReview);
assert.equal(decideManualCredit(attempt, teacher, { ...confirm, reason: " " }, at), originalReview);
for (const excluded of [
  { ...attempt, mode: "link" }, { ...attempt, mode: "self" }, { ...attempt, studentId: null }, { ...attempt, track: "teen" },
  { ...attempt, status: "active" }, { ...attempt, status: "reviewed" }, { ...attempt, reviewedAt: at }, { ...attempt, showResult: true },
  { ...attempt, review: { ...originalReview, tgSentAt: at.toISOString() } },
  ...[{ sent: true }, { sentAt: at.toISOString(), sent: false }, { legacySendId: "old" }, { resultVisible: true },
    { publications: [{ id: "hidden-publication" }], sent: false }].map((report) => ({ ...attempt, review: { ...originalReview, report } })),
]) {
  assert.equal(decideManualCredit(excluded, teacher, confirm, at), excluded.review);
}

const acceptedReview = decideManualCredit(attempt, teacher, confirm, at);
const accepted = { ...attempt, review: acceptedReview };
const scored = manualCreditScore(accepted, task.id);
assert.equal(scored.original, false);
assert.equal(scored.effective, true);
assert.deepEqual(scored.decision, {
  ...evidence, id: "decision-1", proposalId: proposal.id, action: "confirm", teacherId: "teacher",
  at: at.toISOString(), reason: "Both verbs fit this sentence.",
});
assert.equal(acceptedReview.report, originalReview.report);
assert.equal(acceptedReview.writing, originalReview.writing);
assert.equal(accepted.state, state);
assert.equal(manualCreditScore({ ...accepted, showResult: true }, task.id).effective, false);
assert.equal(decideManualCredit(accepted, teacher, confirm, at), acceptedReview);
assert.equal(decideManualCredit(accepted, teacher, { ...confirm, id: "stale-tab" }, at), acceptedReview);

const revoke = { ...confirm, id: "decision-2", action: "revoke", previousEventId: "decision-1", reason: "Withdrawn." } as const;
assert.equal(decideManualCredit(accepted, teacher, { ...revoke, proposal: { ...proposal, id: "different-proposal" } }, at), acceptedReview);
const restored = { ...accepted, review: decideManualCredit(accepted, teacher, revoke, at) };
assert.equal(manualCreditScore(restored, task.id).effective, false);
assert.equal(manualCreditScore(restored, task.id).decision?.action, "revoke");
assert.equal(decideManualCredit(restored, teacher, revoke, at), restored.review);
assert.equal(decideManualCredit(restored, teacher, confirm, at), restored.review);
assert.equal((restored.review.manualCredit as { events: unknown[] }).events.length, 2);
assert.deepEqual(manualCreditScore({ ...restored, review: JSON.parse(JSON.stringify(restored.review)) }, task.id), manualCreditScore(restored, task.id));

const changed = { ...accepted, state: { ...state, answers: { [task.id]: { ...state.answers[task.id], v: "taking" } } } };
assert.equal(manualCreditScore(changed, task.id).effective, false);
assert.equal(decideManualCredit(changed, teacher, revoke, at), acceptedReview);
const withoutKey = { ...attempt, state: { ...state, items: { [task.id]: { ...task, accept: [] } } } };
assert.equal(manualCreditEvidence(withoutKey, task.id), null);
const ambiguousFix = {
  ...attempt, state: { ...state, items: { [task.id]: { ...task, type: "fix" as const, span: [1, 2] as [number, number] } },
    answers: { [task.id]: { v: "1::takes", ok: false } } },
};
assert.equal(manualCreditEvidence(ambiguousFix, task.id), null);
console.log("PASS manual credit: original vs candidate, owner and exact attempt, publication exclusions, confirm and revoke history, retries, changed answer, ambiguous historic records");
