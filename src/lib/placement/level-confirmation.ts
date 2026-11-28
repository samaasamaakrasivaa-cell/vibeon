import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { sylTopic } from "../grammar/syllabus";
import { finalHint, STEPS, topicScore, verdictOf } from "./engine";
import { collectObjectiveFacts } from "./objective-facts";
import { prepareRoadmapResult, writeRoadmapResult, type RoadmapResultAttempt, type VerifiedRoadmapFacts } from "./roadmap-result";
import { stateOf } from "./run";
import { verifiedSpeakingSource } from "./speaking-recording-proof";

type Level = typeof STEPS[number];
type Decision = { revision: string; previousVersion: string | null; level: Level; factIds: string[] };
const digest = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
export const levelConfirmationEnabled = () => process.env.PL_ROADMAP_CONFIRM === "1";

async function levelFacts(attempt: RoadmapResultAttempt, teacherId: string) {
  if (attempt.teacherId !== teacherId || !attempt.submittedAt || !attempt.studentId || attempt.mode !== "student" ||
      (attempt.status !== "submitted" && attempt.status !== "reviewed") || !attempt.state || !attempt.review) return null;
  const state = stateOf(attempt.state);
  const review = attempt.review as Record<string, unknown>;
  const speaking = await verifiedSpeakingSource(attempt.id, state, review);
  const productive = prepareRoadmapResult(attempt, teacherId, () => ({
    level: STEPS[0], skills: [], topics: [], selectedProductiveSkills: ["writing", "speaking"], verifiedSpeakingSource: speaking,
  }));
  if (!productive) return null;
  const objective = collectObjectiveFacts(state);
  const skills = new Map<string, VerifiedRoadmapFacts["skills"][number]>();
  const topics = new Map<string, VerifiedRoadmapFacts["topics"][number]>();
  const facts = objective.facts.map((fact) => {
    if (fact.status !== "checked") return fact;
    const provenance = { scope: fact.scope, evidenceId: digest([attempt.id, objective.revision, fact.factId]) };
    const evidence = objective.evidence[fact.factId];
    if (fact.topicId) {
      const topicId = sylTopic(fact.topicId)?.id ?? fact.topicId;
      const answers = evidence.items.flatMap(({ questionIds }) => questionIds.map((id) => ({ a: state.answers[id] })));
      const verdict = verdictOf(topicScore(answers));
      topics.set(fact.factId, {
        topicId, status: "checked", verdict: verdict === "own" ? "secure" : verdict === "part" ? "partial" : "gap",
        correct: fact.correct, total: fact.total, provenance,
      });
    } else if (fact.level) {
      skills.set(fact.factId, { skill: fact.skill, status: "checked", level: fact.level, provenance });
    }
    return { ...fact, selectable: topics.has(fact.factId) || skills.has(fact.factId) };
  });
  const productiveFacts = productive.facts.skills.flatMap((fact) => {
    if (fact.skill !== "writing" && fact.skill !== "speaking") return [];
    const factId = fact.skill;
    return [fact.status === "checked"
      ? { factId, skill: fact.skill, status: fact.status, level: fact.level as Level, scope: fact.provenance.scope, selectable: true }
      : { factId, skill: fact.skill, status: fact.status, reason: fact.reason }];
  });
  const all = [...facts, ...productiveFacts];
  const levels = new Map<string, number>();
  for (const fact of all) {
    if (fact.status === "checked" && "level" in fact && fact.level && !levels.has(fact.skill)) {
      levels.set(fact.skill, STEPS.indexOf(fact.level));
    }
  }
  const hint = finalHint([...levels.values()]);
  const view = {
    facts: all, revision: digest([productive.command.revision, objective.revision]),
    previousVersion: productive.command.previousVersion, suggestedLevel: hint === null ? null : STEPS[hint],
  };
  return { view, skills, topics, speaking };
}

export async function placementLevelView(attempt: RoadmapResultAttempt, teacherId: string) {
  if (!levelConfirmationEnabled()) return null;
  return (await levelFacts(attempt, teacherId))?.view ?? null;
}

export async function confirmPlacementLevelForTeacher(attemptId: string, teacherId: string, decision: Decision) {
  if (!levelConfirmationEnabled()) return "disabled";
  if (!decision || !STEPS.includes(decision.level) || !Array.isArray(decision.factIds) ||
      decision.factIds.length > 406 || new Set(decision.factIds).size !== decision.factIds.length ||
      decision.factIds.some((id) => typeof id !== "string") ||
      (decision.previousVersion !== null && typeof decision.previousVersion !== "string")) return "invalid";

  const verify = async (attempt: RoadmapResultAttempt): Promise<VerifiedRoadmapFacts | null> => {
    const inputs = await levelFacts(attempt, teacherId);
    if (!inputs || inputs.view.revision !== decision.revision) return null;
    const { topics, skills, speaking, view } = inputs;
    const selectedProductiveSkills: VerifiedRoadmapFacts["selectedProductiveSkills"] = [];
    const chosenTopics: VerifiedRoadmapFacts["topics"] = [];
    const chosenSkills: VerifiedRoadmapFacts["skills"] = [];
    for (const id of decision.factIds) {
      const fact = view.facts.find((entry) => entry.factId === id);
      if (!fact || fact.status !== "checked" || !("selectable" in fact) || !fact.selectable) return null;
      const topic = topics.get(id), skill = skills.get(id);
      if (topic) chosenTopics.push(topic);
      else if (skill) chosenSkills.push(skill);
      else if (id === "writing" || id === "speaking") selectedProductiveSkills.push(id);
    }
    for (const skill of ["grammar", "vocabulary", "reading", "listening"] as const) {
      if (chosenSkills.some((fact) => fact.skill === skill)) continue;
      const gap = view.facts.find((fact) => fact.skill === skill && fact.status === "unknown");
      chosenSkills.push({ skill, status: "unknown", reason: gap?.status === "unknown" ? gap.reason : "not-confirmed" });
    }
    return { level: decision.level, topics: chosenTopics, skills: chosenSkills, selectedProductiveSkills, verifiedSpeakingSource: speaking };
  };

  const attempt = await db.placementAttempt.findFirst({ where: { id: attemptId, teacherId } });
  if (!attempt) return "unavailable";
  const verified = await verify(attempt);
  const prepared = prepareRoadmapResult(attempt, teacherId, () => verified);
  if (!prepared || !levelConfirmationEnabled()) return "stale";
  const result = await writeRoadmapResult(db, teacherId, { ...prepared.command, previousVersion: decision.previousVersion },
    (fresh) => levelConfirmationEnabled() ? verify(fresh) : null);
  return result.status;
}
