import { z } from "zod";
import { sylTopic } from "../grammar/syllabus";
import { LEVELS, SKILLS, type Stage } from "./cefr";
import { routeState } from "./math";

const id = z.string().min(1).max(120);
const level = z.enum([...LEVELS, "A1-", "A2-", "B1-", "B2-", "C1-"]);
const provenance = z.object({
  scope: z.enum(["initial", "additional", "reassessment", "teacher-adjustment"]),
  evidenceId: id,
}).strict();
const absent = z.enum(["not-tested", "not-confirmed", "unknown-origin"]);
const topicFact = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("checked"), topicId: id, verdict: z.enum(["gap", "partial", "secure"]),
    correct: z.number().int().nonnegative(), total: z.number().int().positive(), provenance,
  }).strict(),
  z.object({ status: z.literal("unknown"), topicId: id, reason: absent }).strict(),
]);
const skillFact = z.discriminatedUnion("status", [
  z.object({ status: z.literal("checked"), skill: z.enum(SKILLS), level, provenance }).strict(),
  z.object({ status: z.literal("unknown"), skill: z.enum(SKILLS), reason: absent }).strict(),
]);

export const confirmedPlacementSchema = z.object({
  attemptId: id,
  version: id,
  confirmedAt: z.string().datetime(),
  level,
  topics: z.array(topicFact).max(400),
  skills: z.array(skillFact).max(SKILLS.length),
}).strict().superRefine((value, ctx) => {
  const topicIds = value.topics.map((fact) => sylTopic(fact.topicId)?.id ?? fact.topicId);
  if (new Set(topicIds).size !== topicIds.length
    || new Set(value.skills.map((fact) => fact.skill)).size !== value.skills.length
    || value.topics.some((fact) => fact.status === "checked" && fact.correct > fact.total)
    || (!value.topics.length && !value.skills.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ambiguous diagnostic facts" });
  }
});

export type ConfirmedPlacement = z.infer<typeof confirmedPlacementSchema>;
export type CheckedTopic = Extract<ConfirmedPlacement["topics"][number], { status: "checked" }>;
type CheckedPoint = { point: NonNullable<Stage["points"]>[number]; position: number; facts: CheckedTopic[]; priority: number };
const priority = { gap: 0, partial: 1, secure: 2 };
export type PlacementStageChange = {
  stage: number;
  before: string[];
  after: string[];
  moved: { title: string; from: number; to: number; facts: CheckedTopic[] }[];
};

export function planPlacementUpdate(
  stages: Stage[],
  protectedHours: number,
  checkpoints: { stage: number | null; kind: string; source: string; status: string }[],
  source: ConfirmedPlacement,
) {
  const changes: PlacementStageChange[] = [];
  const unknownPoints: { title: string; topicIds: string[] }[] = [];
  const facts = new Map(source.topics.map((fact) => [sylTopic(fact.topicId)?.id ?? fact.topicId, fact]));
  const pointIds = stages.flatMap((stage) => (stage.points ?? []).map((point) => point.id));
  // A completed external result is recorded without a stage by design. It does not mark a route stage as passed.
  const stageChecks = checkpoints.filter(({ stage, kind, source, status }) =>
    !(stage === null && kind === "slice" && source === "manual" && status === "done"));
  const unresolvedCheckpoint = stageChecks.some(({ stage }) =>
    stage === null || !Number.isInteger(stage) || stage < 0 || stage >= stages.length);
  const unresolvedRoute = !Number.isFinite(protectedHours) || protectedHours < 0
    || stages.some((stage) => !Number.isFinite(stage.hours) || stage.hours <= 0)
    || pointIds.some((pointId) => !pointId) || new Set(pointIds).size !== pointIds.length;
  const blockedBy = unresolvedCheckpoint ? "checkpoint" as const : unresolvedRoute ? "route" as const : null;
  if (blockedBy || !stages.length) return { stages, changes, unknownPoints, blockedBy };

  // Keep the entire current stage and the prefix through every stage-linked slice or recorded milestone.
  let protectedThrough = Math.max(routeState(stages, protectedHours).ci, ...stageChecks.map(({ stage }) => stage!));
  stages.forEach((stage, index) => {
    if (stage.passed || stage.canDone?.length || stage.points?.some((point) => point.done !== undefined)) {
      protectedThrough = Math.max(protectedThrough, index);
    }
  });

  const next = stages.map((stage, index) => {
    if (index <= protectedThrough || !stage.points?.length) return stage;
    const points = stage.points;
    const checked: CheckedPoint[] = [];
    for (const [position, point] of points.entries()) {
      const keys = (point.topics ?? []).map((topic) => sylTopic(topic)?.id);
      const matched = keys.map((key) => key ? facts.get(key) : undefined);
      const known = matched.filter((fact): fact is CheckedTopic => fact?.status === "checked");
      if (!keys.length || known.length !== keys.length) {
        unknownPoints.push({ title: point.title, topicIds: keys.flatMap((key, i) => key && matched[i]?.status !== "checked" ? [key] : []) });
        continue;
      }
      checked.push({ point, position, facts: known, priority: Math.min(...known.map((fact) => priority[fact.verdict])) });
    }

    const ordered = [...checked].sort((a, b) => a.priority - b.priority);
    const updated = [...points];
    const moved: PlacementStageChange["moved"] = [];
    ordered.forEach((entry, i) => {
      const position = checked[i].position;
      updated[position] = entry.point;
      if (entry.position !== position) {
        moved.push({ title: entry.point.title, from: entry.position + 1, to: position + 1, facts: entry.facts });
      }
    });
    if (!moved.length) return stage;
    changes.push({
      stage: index,
      before: points.map((point) => point.title),
      after: updated.map((point) => point.title),
      moved,
    });
    // Generated routes mirror their point titles here. Independently edited/legacy grammar lists are preserved.
    const grammar = Array.isArray(stage.grammar) && stage.grammar.length === points.length && stage.grammar.every((title, i) => title === points[i].title)
      ? updated.map((point) => point.title) : stage.grammar;
    return { ...stage, points: updated, grammar };
  });
  return { stages: next, changes, unknownPoints, blockedBy };
}
