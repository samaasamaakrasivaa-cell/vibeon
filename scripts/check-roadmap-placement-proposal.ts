import assert from "node:assert/strict";
import type { Stage } from "../src/lib/roadmap/cefr";
import { confirmedPlacementSchema, planPlacementUpdate } from "../src/lib/roadmap/placement-proposal";

const topic = {
  secure: "g-b1-passive-basic",
  unknown: "g-b1-articles-general",
  gap: "g-b1-second-conditional",
  partial: "g-b1-past-perfect",
};
const point = (name: string, topicId = topic.gap, done?: boolean) => ({
  id: name, title: name, level: "B1", hours: 2, why: "", focus: "", topics: [topicId], ...(done === undefined ? {} : { done }),
});
const stage = (title: string, points: NonNullable<Stage["points"]>, history: Partial<Stage> = {}): Stage => ({
  lvl: "B1", title, hours: points.length * 2, grammar: points.map((p) => p.title), vocabulary: [], skills: [], points, ...history,
});
const checked = (topicId: string, verdict: "secure" | "gap" | "partial", correct: number) => ({
  status: "checked", topicId, verdict, correct, total: 4,
  provenance: { scope: "initial", evidenceId: "test-evidence" },
});
const source = {
  attemptId: "synthetic", version: "v1", confirmedAt: "2026-11-27T12:00:00.000Z", level: "B1",
  topics: [checked(topic.secure, "secure", 4), checked(topic.gap, "gap", 1), checked(topic.partial, "partial", 2),
    { status: "unknown", topicId: topic.unknown, reason: "not-tested" }],
  skills: [{ status: "unknown", skill: "speaking", reason: "not-confirmed" }],
};
const result = confirmedPlacementSchema.parse(source);
const planned = (prefix: string) => [
  point(`${prefix}-secure`, topic.secure),
  point(`${prefix}-unknown`, topic.unknown),
  point(`${prefix}-gap`, topic.gap),
  point(`${prefix}-partial`, topic.partial),
];
const orders = (stages: Stage[]) => stages.map((s) => s.points?.map((p) => p.id));
const original = [
  stage("completed", [point("past", topic.gap, true)], { passed: { score: 80, at: "2026-11-20" } }),
  stage("current", planned("current"), { checkpoint: { tests: ["grammar"], pass_rule: "80%", approved: true } }),
  stage("future", planned("future")),
];

{
  const snapshot = structuredClone(original);
  const plan = planPlacementUpdate(original, 3, [{ stage: 1 }], result);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(orders(plan.stages)[2], ["future-gap", "future-unknown", "future-partial", "future-secure"]);
  assert.deepEqual(plan.changes[0].moved.find((move) => move.title === "future-gap")?.facts[0].correct, 1);
}
{
  const plan = planPlacementUpdate(original, 3, [{ stage: 1 }], result);
  assert.deepEqual(plan.stages.slice(0, 2), original.slice(0, 2));
  assert.deepEqual(plan.stages.map((s) => s.hours), original.map((s) => s.hours));
  assert.deepEqual(plan.stages.map((s) => s.checkpoint), original.map((s) => s.checkpoint));
}
{
  const plan = planPlacementUpdate(original, 3, [], result);
  assert.deepEqual(plan.unknownPoints, [{ title: "future-unknown", topicIds: [topic.unknown] }]);
  assert.equal(plan.stages[2].points?.[1], original[2].points?.[1]);
  assert.ok(plan.stages[2].points?.every((p) => p.done === undefined));
}
{
  const beyond = [...original, stage("after", planned("after"))];
  assert.deepEqual(planPlacementUpdate(beyond, 3, [{ stage: 2 }], result).changes.map((c) => c.stage), [3]);
  assert.deepEqual(planPlacementUpdate(beyond, 10.1, [], result).changes.map((c) => c.stage), [3]);
  beyond[2].points![0].done = false;
  assert.deepEqual(planPlacementUpdate(beyond, 3, [], result).changes.map((c) => c.stage), [3]);
}
{
  const plan = planPlacementUpdate(original, 3, [], result);
  assert.deepEqual(planPlacementUpdate(plan.stages, 3, [], result).changes, []);
}
{
  assert.equal(confirmedPlacementSchema.safeParse({ ...source, version: "" }).success, false);
  assert.equal(confirmedPlacementSchema.safeParse({ ...source, topics: [checked(topic.gap, "gap", 5)] }).success, false);
  assert.equal(confirmedPlacementSchema.safeParse({ ...source, topics: [checked(topic.gap, "gap", 1), checked(topic.gap, "partial", 2)] }).success, false);
  assert.equal(confirmedPlacementSchema.safeParse({ ...source, topics: [{ ...checked(topic.gap, "gap", 1), provenance: undefined }] }).success, false);
  assert.equal(confirmedPlacementSchema.safeParse({ ...source, topics: [{ status: "unknown", topicId: topic.gap, verdict: "secure", reason: "unknown-origin" }] }).success, false);
}
{
  const duplicate = [...original, stage("ambiguous", planned("future"))];
  assert.equal(planPlacementUpdate(duplicate, 3, [], result).ambiguous, true);
  assert.equal(planPlacementUpdate(original, 3, [{ stage: null }], result).ambiguous, true);
  assert.equal(planPlacementUpdate(original, 3, [{ stage: 9 }], result).ambiguous, true);
  const noMapping = [original[0], original[1], stage("legacy", [point("legacy", "old-name-only")])];
  assert.deepEqual(planPlacementUpdate(noMapping, 3, [], result).changes, []);
}

console.log("PT-05: seven groups passed");
