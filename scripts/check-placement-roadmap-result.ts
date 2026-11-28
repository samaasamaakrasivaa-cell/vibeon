import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { emptyState, type SpeakItem, type WriteItem } from "../src/lib/placement/engine";
import { prepareRoadmapResult, writeRoadmapResult } from "../src/lib/placement/roadmap-result";
import { RUB_V2 } from "../src/lib/placement/rubric";
import { updateWsAssessment, wsAssessmentSource } from "../src/lib/placement/ws-assessment";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/pt_roadmap_writer_fixture");
const db = new PrismaClient();
const fixture = randomUUID();
const at = new Date("2026-11-28T10:00:00.000Z");
const base = { level: "B1", band: 0, topic_en: "Travel", topic_ru: "Поездки" } as const;
const writing: WriteItem = {
  ...base, id: "fixture-writing", type: "writing", skill: "writing", expects: [],
  prompt_en: "Describe a trip.", prompt_ru: "Опишите поездку.", min_words: 20, max_words: 100, time_min: 10,
};
const speaking: SpeakItem = {
  ...base, id: "fixture-speaking", type: "speaking", skill: "speaking", expects: [],
  intro_ru: "Расскажите о поездке.", questions: [{ q: "Where did you go?", prep_sec: 10, speak_sec: 30 }],
};
const state = {
  ...emptyState(), section: "done" as const, items: { [writing.id]: writing, [speaking.id]: speaking },
  writing: { id: writing.id, text: "I visited a city." }, speaking: { id: speaking.id, rec: { "1": "fixture-audio.ogg|audio/ogg" } },
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
type Verify = Parameters<typeof prepareRoadmapResult>[2];
const scope = { scope: "initial", evidenceId: "fixture-core" } as const;

async function main() {
  const teacher = await db.user.create({ data: {
    email: `${fixture}-teacher@example.invalid`, name: "Fixture teacher", role: "TEACHER",
    teacherProfile: { create: { trialUntil: new Date("2099-01-01") } },
  } });
  const other = await db.user.create({ data: { email: `${fixture}-other@example.invalid`, name: "Another teacher", role: "TEACHER" } });
  const learner = await db.student.create({ data: { name: "Fixture learner", teacherId: teacher.id, level: "A2" } });
  const roadmap = await db.roadmap.create({ data: {
    studentId: learner.id, type: "ge", goal: "B2", approvedAt: at, fromLevel: "A2",
    stages: [{ lvl: "A2", title: "Existing stage", hours: 2, points: [{ id: "old", done: true }] }],
  } });
  const checkpoint = await db.checkpoint.create({ data: {
    studentId: learner.id, roadmapId: roadmap.id, kind: "entry", source: "placement", status: "done", level: "A2", takenAt: at, results: { writing: 50 },
  } });
  await db.lessonProgress.create({ data: { owner: `s:${learner.id}`, templateId: "fixture", state: "done" } });
  const report = { sent: true, resultVisible: true, publications: [{ schema: 1, id: "shared-1", sentAt: at.toISOString(), sheet: { input: { level: "A2" } } }] };
  const wSource = wsAssessmentSource(state, "writing", RUB_V2);
  const sSource = wsAssessmentSource(state, "speaking", RUB_V2);
  const marks = (kind: "writing" | "speaking") => Object.fromEntries(RUB_V2[kind].map(({ id }) => [id, 5]));
  const confirmation = (kind: "writing" | "speaking") => ({ marks: marks(kind), teacherId: teacher.id, at: at.toISOString() });
  const emptyReview = { rubric: 2, report, writing: { content: 2 }, comment: "Preserve this", ai: { speaking: { summary: "Legacy, unconfirmed" } } };
  let review = updateWsAssessment(updateWsAssessment(emptyReview, wSource, { type: "sync" }), sSource, { type: "sync" });
  review = updateWsAssessment(review, wSource, { type: "confirm", generation: 1, confirmation: confirmation("writing") });
  review = updateWsAssessment(review, sSource, { type: "request", id: "fixture-ai", previousSequence: null, generation: 1 });
  review = updateWsAssessment(review, sSource, { type: "result", id: "fixture-ai", sequence: 1, generation: 1, at: at.toISOString(),
    score: { scores: marks("speaking"), why: {}, summary: "Synthetic draft" } });
  const draftReview = review;
  review = updateWsAssessment(review, sSource, { type: "confirm", generation: 1, confirmation: confirmation("speaking") });
  const attempt = await db.placementAttempt.create({ data: {
    mode: "student", teacherId: teacher.id, studentId: learner.id, checkpointId: checkpoint.id, token: fixture, state: json(state),
    review: json(review), status: "reviewed", level: "A2", reviewedAt: at, showResult: true,
  } });
  const read = () => db.placementAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  const protection = () => Promise.all([
    db.roadmap.findUniqueOrThrow({ where: { id: roadmap.id } }),
    db.checkpoint.findUniqueOrThrow({ where: { id: checkpoint.id } }),
    db.student.findUniqueOrThrow({ where: { id: learner.id } }),
    db.lessonProgress.findMany({ where: { owner: `s:${learner.id}` } }),
  ]);
  const baseline = await protection();
  const verify: Verify = () => ({
    level: "B1",
    topics: [{ topicId: "g-b1-second-conditional", status: "checked", correct: 1, total: 4, verdict: "gap", provenance: scope }],
    skills: [{ skill: "grammar", status: "checked", level: "B1", provenance: scope }, { skill: "listening", status: "unknown", reason: "not-tested" }],
    selectedProductiveSkills: ["writing", "speaking"],
    verifiedSpeakingSource: sSource.fingerprint!,
  });
  const prepared = prepareRoadmapResult(attempt, teacher.id, verify)!;
  assert.ok(prepared);
  assert.deepEqual(prepared.facts.skills.filter(({ status }) => status === "checked").map(({ skill }) => skill), ["grammar", "writing", "speaking"]);
  assert.equal(prepareRoadmapResult(attempt, teacher.id, () => null), null);
  assert.equal(prepareRoadmapResult({ ...attempt, mode: "link" }, teacher.id, verify), null);
  assert.equal(prepareRoadmapResult({ ...attempt, status: "active" }, teacher.id, verify), null);
  assert.deepEqual(await writeRoadmapResult(db, other.id, prepared.command, verify), { status: "unavailable" });
  assert.deepEqual(await writeRoadmapResult(db, teacher.id, prepared.command, () => null), { status: "stale" });
  assert.deepEqual(await read(), attempt);

  function fact(row: typeof attempt, skill: "writing" | "speaking", verifier = verify) {
    return prepareRoadmapResult(row, teacher.id, verifier)?.facts.skills.find((entry) => entry.skill === skill);
  }
  assert.deepEqual(fact({ ...attempt, review: draftReview as Prisma.JsonObject }, "speaking"),
    { skill: "speaking", status: "unknown", reason: "not-confirmed" });
  assert.deepEqual(fact(attempt, "speaking", (row) => ({ ...verify(row)!, verifiedSpeakingSource: "another recording" })),
    { skill: "speaking", status: "unknown", reason: "unknown-origin" });
  const changedAudio = { ...state, speaking: { ...state.speaking, rec: { "1": "replacement.ogg|audio/ogg" } } };
  assert.deepEqual(fact({ ...attempt, state: changedAudio }, "speaking"), { skill: "speaking", status: "unknown", reason: "not-confirmed" });
  const emptyWriting = { ...state, writing: { ...state.writing, text: "" } };
  assert.deepEqual(fact({ ...attempt, state: emptyWriting }, "writing"), { skill: "writing", status: "unknown", reason: "not-tested" });

  await db.placementAttempt.update({ where: { id: attempt.id }, data: { state: json(changedAudio) } });
  const beforeStale = await read();
  assert.deepEqual(await writeRoadmapResult(db, teacher.id, prepared.command, verify), { status: "stale" });
  assert.deepEqual(await read(), beforeStale);
  await db.placementAttempt.update({ where: { id: attempt.id }, data: { state: json(state) } });

  const writes = await Promise.all([
    writeRoadmapResult(db, teacher.id, prepared.command, verify),
    writeRoadmapResult(db, teacher.id, prepared.command, verify),
  ]);
  assert.deepEqual(writes.map(({ status }) => status).sort(), ["saved", "unchanged"]);
  const first = writes.find((response) => response.status === "saved");
  assert.ok(first?.status === "saved");
  const initialRow = await read();
  assert.deepEqual(writes.find((response) => response.status === "unchanged")?.result, first.result);
  assert.deepEqual((initialRow.review as Prisma.JsonObject).roadmapResultV1, first.result);
  assert.equal(first.result.level, "B1");
  assert.deepEqual(first.result.skills.flatMap((entry) => entry.status === "checked" &&
    (entry.skill === "writing" || entry.skill === "speaking") ? [entry.provenance.scope] : []), ["initial", "initial"]);
  assert.equal(new Date(first.result.confirmedAt).toISOString(), first.result.confirmedAt);
  assert.deepEqual(await writeRoadmapResult(db, teacher.id, prepared.command, verify), { status: "unchanged", result: first.result });
  assert.deepEqual(await read(), initialRow);

  const replacement: Verify = (row) => ({ ...verify(row)!, level: "B1+" });
  assert.deepEqual(await writeRoadmapResult(db, teacher.id, prepared.command, replacement), { status: "stale" });
  const next = prepareRoadmapResult(initialRow, teacher.id, replacement)!;
  const editedReport = { ...report, draftIds: { student: "concurrent-draft" } };
  let edited = false;
  const racingClient = {
    placementAttempt: new Proxy(db.placementAttempt, {
      get(target, key, receiver) {
        if (key !== "updateMany") return Reflect.get(target, key, receiver);
        return async (args: Prisma.PlacementAttemptUpdateManyArgs) => {
          if (!edited) {
            edited = true;
            await db.placementAttempt.update({
              where: { id: attempt.id }, data: { review: json({ ...review, roadmapResultV1: first.result, report: editedReport }) },
            });
          }
          return db.placementAttempt.updateMany(args);
        };
      },
    }),
  };
  const saved = await writeRoadmapResult(racingClient, teacher.id, next.command, replacement);
  assert.ok(saved.status === "saved");
  assert.notEqual(saved.result.version, first.result.version);
  assert.deepEqual(await writeRoadmapResult(db, teacher.id, prepared.command, verify), { status: "stale" });
  const finalRow = await read();
  assert.deepEqual(finalRow, { ...initialRow, updatedAt: finalRow.updatedAt,
    review: { ...review, report: editedReport, roadmapResultV1: saved.result } });
  assert.deepEqual(await protection(), baseline);

  const confirmationMs = at.getTime();
  const added = confirmationMs - 60_000;
  const afterAdd = confirmationMs - 30_000;
  const beforeAdd = confirmationMs - 120_000;
  // addSections keeps only the latest added timestamp and the final list of parts.
  const addedState = { ...state, parts: ["reading", "writing", "speaking"], added };
  const cases = [
    { label: "both added", sdates: { reading: beforeAdd, writing: afterAdd, speaking: afterAdd },
      expected: ["additional", "additional"] },
    { label: "older Writing", sdates: { reading: beforeAdd, writing: beforeAdd, speaking: afterAdd },
      expected: ["unknown-origin", "additional"] },
    { label: "older Speaking", sdates: { reading: beforeAdd, writing: afterAdd, speaking: beforeAdd },
      expected: ["additional", "unknown-origin"] },
    { label: "missing or tied dates", sdates: { reading: beforeAdd, speaking: added },
      expected: ["unknown-origin", "unknown-origin"] },
    { label: "unlisted Speaking", parts: ["reading", "writing"], sdates: { reading: beforeAdd, writing: afterAdd, speaking: afterAdd },
      expected: ["additional", "unknown-origin"] },
    { label: "explicit extra assignment", sdates: { reading: beforeAdd, writing: beforeAdd, speaking: beforeAdd },
      wsExtra: { writing: 1, speaking: -1 }, expected: ["additional", "additional"] },
  ];
  const snapshots = [first.result, saved.result];
  for (const scenario of cases) {
    const row = await db.placementAttempt.create({ data: {
      mode: "student", teacherId: teacher.id, studentId: learner.id, token: randomUUID(),
      state: json({ ...addedState, parts: scenario.parts ?? addedState.parts, sdates: scenario.sdates, wsExtra: scenario.wsExtra }),
      review: json(review), status: "submitted", submittedAt: at,
    } });
    const { command } = prepareRoadmapResult(row, teacher.id, verify)!;
    const result = await writeRoadmapResult(db, teacher.id, command, verify);
    assert.ok(result.status === "saved", scenario.label);
    const persisted = await db.placementAttempt.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual((persisted.review as Prisma.JsonObject).roadmapResultV1, result.result);
    const expected = ["writing", "speaking"].map((skill, index) => {
      const scope = scenario.expected[index];
      return scope === "unknown-origin" ? { skill, status: "unknown", reason: scope } : { skill, status: "checked", scope };
    });
    const productive = result.result.skills.filter(({ skill }) => skill === "writing" || skill === "speaking");
    assert.deepEqual(productive.map((fact) => fact.status === "checked"
      ? { skill: fact.skill, status: fact.status, scope: fact.provenance.scope }
      : fact), expected, scenario.label);
    snapshots.push(result.result);
  }
  assert.deepEqual(await protection(), baseline);
  console.log("PASS persisted Writing/Speaking provenance after addSections, mixed and ambiguous history, explicit extra assignments");

  if (process.env.ROADMAP_CONTRACT_MODULE) {
    const { confirmedPlacementSchema } = await import(pathToFileURL(process.env.ROADMAP_CONTRACT_MODULE).href);
    for (const snapshot of snapshots) assert.deepEqual(confirmedPlacementSchema.parse(snapshot), snapshot);
    console.log("PASS all persisted snapshots accepted by Roadmap PR #105 schema");
  }
  console.log("PASS first write, concurrent replay, immutable timestamp, obsolete inputs, current Writing/Speaking, concurrent report draft, old publication, Roadmap, progress and Checkpoint");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
