import "server-only";
import { createHash } from "node:crypto";
import type { PlacementAttempt, Prisma } from "@prisma/client";
import { sylTopic } from "../grammar/syllabus";
import { LEVELS, SKILLS } from "../roadmap/cefr";
import { STEPS, type PState } from "./engine";
import { gateKey, RUB_V2, stepBy } from "./rubric";
import { readWsAssessment, wsAssessmentSource } from "./ws-assessment";

type Level = typeof LEVELS[number] | "A1-" | "A2-" | "B1-" | "B2-" | "C1-";
type Skill = typeof SKILLS[number];
type ProductiveSkill = "writing" | "speaking";
type Origin = { scope: "initial" | "additional" | "reassessment" | "teacher-adjustment"; evidenceId: string };
type Unknown = { status: "unknown"; reason: "not-tested" | "not-confirmed" | "unknown-origin" };
type Checked<T> = T & { status: "checked"; provenance: Origin };
type TopicFact = { topicId: string } & (Unknown | Checked<{ verdict: "gap" | "partial" | "secure"; correct: number; total: number }>);
type SkillFact<K extends Skill = Skill> = { skill: K } & (Unknown | Checked<{ level: Level }>);
type Facts = { level: Level; topics: TopicFact[]; skills: SkillFact[] };
type VerifiedFacts = {
  level: Level;
  topics: TopicFact[];
  skills: SkillFact<Exclude<Skill, ProductiveSkill>>[];
  selectedProductiveSkills: ProductiveSkill[];
  // The caller verifies per-recording provenance and supplies the matching server-side source fingerprint.
  verifiedSpeakingSource?: string;
};
type Attempt = Pick<PlacementAttempt, "id" | "teacherId" | "studentId" | "mode" | "status" | "updatedAt" | "level" | "state" | "review">;
type Command = { attemptId: string; revision: string; previousVersion: string | null };
type Verify = (attempt: Attempt) => VerifiedFacts | null;
type ConfirmedRoadmapResult = Facts & { attemptId: string; version: string; confirmedAt: string };

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value, (_, object) => {
    if (!object || typeof object !== "object" || Array.isArray(object)) return object;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
  })).digest("hex");
}

const isObject = (value: Prisma.JsonValue): value is Prisma.JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
const fitsId = (id: string) => typeof id === "string" && id.trim().length > 0 && id.length <= 120;
const isLevel = (level: Level) => (LEVELS as readonly string[]).includes(level) || ["A1-", "A2-", "B1-", "B2-", "C1-"].includes(level);
const unique = (ids: string[]) => new Set(ids).size === ids.length;
const origin = ({ scope, evidenceId }: Origin): Origin => ({ scope, evidenceId });

function topicFact(fact: TopicFact): TopicFact {
  const { topicId, status } = fact;
  return status === "unknown" ? { topicId, status, reason: fact.reason } : {
    topicId, status, verdict: fact.verdict, correct: fact.correct, total: fact.total, provenance: origin(fact.provenance),
  };
}

function productiveScope(state: PState, kind: ProductiveSkill): Origin["scope"] | null {
  const extra = state.wsExtra?.[kind];
  if (extra !== undefined) return extra === 1 || extra === -1 ? "additional" : null;
  const added = state.added;
  if (added === undefined) return "initial";

  // addSections overwrites the global timestamp, so earlier completions cannot identify the round.
  const completed = state.sdates?.[kind];
  if (!state.parts?.includes(kind) || !Number.isSafeInteger(added) || added <= 0 ||
      completed === undefined || !Number.isSafeInteger(completed) || completed <= added) return null;
  return "additional";
}

function productiveFact(attempt: Attempt, state: PState, review: Prisma.JsonObject, kind: ProductiveSkill, verified: VerifiedFacts): SkillFact {
  const unknown = (reason: Unknown["reason"]): SkillFact => ({ skill: kind, status: "unknown", reason });
  const source = wsAssessmentSource(state, kind, RUB_V2);
  if (!source.hasAnswer) return unknown("not-tested");
  if (!verified.selectedProductiveSkills.includes(kind)) return unknown("not-confirmed");
  const { confirmation, generation } = readWsAssessment(review, source);
  if (!confirmation || generation === null || confirmation.teacherId !== attempt.teacherId) return unknown("not-confirmed");
  if (kind === "speaking" && (!verified.verifiedSpeakingSource || verified.verifiedSpeakingSource !== source.fingerprint)) return unknown("unknown-origin");
  const item = state.items[state[kind]!.id];
  const marks = RUB_V2[kind].map(({ id }) => confirmation.marks[id]);
  if (marks.some((mark) => !Number.isInteger(mark) || mark < 0 || mark > RUB_V2.max)) return unknown("not-confirmed");
  const step = stepBy(RUB_V2, marks, item.level, kind === "writing" ? confirmation.marks[gateKey(RUB_V2)] : undefined);
  if (step === null) return unknown("not-confirmed");
  const scope = productiveScope(state, kind);
  if (!scope) return unknown("unknown-origin");
  return {
    skill: kind, status: "checked", level: STEPS[step],
    provenance: {
      scope,
      evidenceId: `ws:${kind}:${digest([attempt.id, source.fingerprint, generation, confirmation])}`,
    },
  };
}

/** Build a command from the same server-verified inputs that will be checked again at confirmation. */
export function prepareRoadmapResult(attempt: Attempt, teacherId: string, verify: Verify) {
  const { review, state } = attempt;
  if (attempt.teacherId !== teacherId || attempt.mode !== "student" || !attempt.studentId ||
      (attempt.status !== "submitted" && attempt.status !== "reviewed") || !isObject(review) || !isObject(state)) return null;
  const stored = review.roadmapResultV1;
  if (stored !== undefined && (!isObject(stored) || stored.attemptId !== attempt.id || typeof stored.version !== "string" ||
      !fitsId(stored.version) || typeof stored.confirmedAt !== "string")) return null;

  const verified = verify(attempt);
  if (!verified || !fitsId(attempt.id) || !isLevel(verified.level) || verified.topics.length > 400 ||
      !unique(verified.topics.map(({ topicId }) => sylTopic(topicId)?.id ?? topicId)) ||
      !unique(verified.skills.map(({ skill }) => skill))) return null;
  if (verified.topics.some((fact) => !fitsId(fact.topicId) || (fact.status === "checked" &&
      (!fitsId(fact.provenance.evidenceId) || !Number.isInteger(fact.correct) || !Number.isInteger(fact.total) ||
        fact.correct < 0 || fact.total <= 0 || fact.correct > fact.total)))) return null;
  if (verified.skills.some((fact) => fact.status === "checked" && (!isLevel(fact.level) || !fitsId(fact.provenance.evidenceId)))) return null;

  const facts: Facts = {
    level: verified.level,
    topics: verified.topics.map(topicFact).sort((a, b) => a.topicId.localeCompare(b.topicId)),
    skills: SKILLS.map((skill): SkillFact => {
      if (skill === "writing" || skill === "speaking") return productiveFact(attempt, state as unknown as PState, review, skill, verified);
      const fact = verified.skills.find((entry) => entry.skill === skill);
      return fact?.status === "checked"
        ? { skill, status: "checked", level: fact.level, provenance: origin(fact.provenance) }
        : { skill, status: "unknown", reason: fact?.reason ?? "not-confirmed" };
    }),
  };
  // Reports and unrelated review writes are deliberately excluded from the revision.
  const revision = digest([attempt.id, attempt.teacherId, attempt.studentId, attempt.status, attempt.level, state, facts]);
  return { facts, command: { attemptId: attempt.id, revision, previousVersion: stored?.version as string | undefined ?? null } };
}

/** Internal writer. Connect only to the explicit level-confirmation action after PT-08 and PT-10. */
export async function writeRoadmapResult(
  client: Pick<Prisma.TransactionClient, "placementAttempt">,
  teacherId: string,
  command: Command,
  verify: Verify,
) {
  const version = digest([command.attemptId, command.revision, command.previousVersion]);
  for (let retry = 0; retry < 3; retry++) {
    const attempt = await client.placementAttempt.findFirst({
      where: { id: command.attemptId, teacherId, mode: "student", studentId: { not: null } },
      select: { id: true, teacherId: true, studentId: true, mode: true, status: true, updatedAt: true, level: true, state: true, review: true },
    });
    if (!attempt || !isObject(attempt.state) || !isObject(attempt.review)) return { status: "unavailable" as const };
    const prepared = prepareRoadmapResult(attempt, teacherId, verify);
    if (!prepared || prepared.command.revision !== command.revision) return { status: "stale" as const };
    if (prepared.command.previousVersion === version) {
      return { status: "unchanged" as const, result: attempt.review.roadmapResultV1 as ConfirmedRoadmapResult };
    }
    if (prepared.command.previousVersion !== command.previousVersion) return { status: "stale" as const };

    const result: ConfirmedRoadmapResult = { attemptId: attempt.id, version, confirmedAt: new Date().toISOString(), ...prepared.facts };
    const saved = await client.placementAttempt.updateMany({
      where: { id: attempt.id, teacherId, studentId: attempt.studentId, mode: attempt.mode, status: attempt.status,
        updatedAt: attempt.updatedAt, level: attempt.level, state: { equals: attempt.state }, review: { equals: attempt.review } },
      data: { review: { ...attempt.review, roadmapResultV1: result } },
    });
    if (saved.count) return { status: "saved" as const, result };
  }
  return { status: "stale" as const };
}
