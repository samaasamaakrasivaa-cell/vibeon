import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { emptyState, type CoreItem } from "../src/lib/placement/engine";
import { manualCreditEvidence } from "../src/lib/placement/manual-credit";
import { writeManualCredit } from "../src/lib/placement/manual-credit-write";
import { json } from "../src/lib/placement/run";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/pt_manual_credit_fixture");

const item: CoreItem = {
  id: "fixture-question", type: "gap", skill: "grammar", level: "B1", band: 0, topic_id: "present",
  topic_en: "Present", topic_ru: "Настоящее", q: "She ___ the bus every day.", accept: ["takes"], explain_ru: "",
};
const state = {
  ...emptyState(), section: "done" as const, items: { [item.id]: item }, core: [{ id: item.id, step: 4 }],
  answers: { [item.id]: { v: "catches", ok: false } },
};
const review = { writing: { task: 2 }, report: { draft: { student: { lang: "en" } } } };
const publication = { ...review.report, sent: true, publications: [{ id: "fixture-publication" }] };

async function main() {
  const teacher = await db.user.create({ data: {
    name: "Fixture teacher", email: randomUUID() + "@example.invalid", role: "TEACHER",
    teacherProfile: { create: { trialUntil: new Date("2099-01-01") } },
  } });
  try {
    const learner = await db.student.create({ data: { teacherId: teacher.id, name: "Fixture learner" } });
    const checkpoint = await db.checkpoint.create({
      data: { studentId: learner.id, kind: "entry", source: "placement", status: "done", level: "A2", results: { fixture: true } },
    });
    const actor = { id: teacher.id, role: "TEACHER" };
    const get = (id: string) => db.placementAttempt.findUniqueOrThrow({ where: { id } });
    async function fixture(checkpointId?: string) {
      const a = await db.placementAttempt.create({ data: {
        teacherId: teacher.id, studentId: learner.id, checkpointId, mode: "student", status: "submitted",
        token: randomUUID(), state: json(state), review, level: "A2",
      } });
      const evidence = manualCreditEvidence({ ...a, state, review }, item.id)!;
      const proposal = { ...evidence, id: "fixture-proposal", attemptId: a.id };
      return { a, decision: { id: "fixture-confirm", proposal, action: "confirm" as const, previousEventId: null, reason: "Both verbs fit." } };
    }

    const normal = await fixture(checkpoint.id);
    const { id } = normal.a;
    assert.equal(await writeManualCredit(id, { ...actor, id: "foreign" }, normal.decision), "not-found");
    assert.equal(await writeManualCredit(id, { ...actor, role: "STUDENT" }, normal.decision), "rejected");
    assert.deepEqual(await get(id), normal.a);
    const confirm = () => writeManualCredit(id, actor, normal.decision);
    assert.deepEqual((await Promise.all([confirm(), confirm()])).sort(), ["rejected", "saved"]);
    const revoke = { ...normal.decision, id: "fixture-revoke", action: "revoke" as const, previousEventId: normal.decision.id };
    assert.equal(await writeManualCredit(id, actor, revoke), "saved");
    assert.equal(await writeManualCredit(id, actor, revoke), "rejected");
    const after = await get(id);
    assert.deepEqual(after.state, normal.a.state);
    assert.equal(after.level, normal.a.level);
    assert.deepEqual((after.review as Record<string, unknown>).report, review.report);
    assert.deepEqual((after.review as { manualCredit: { events: { action: string }[] } }).manualCredit.events.map((event) => event.action), ["confirm", "revoke"]);
    assert.deepEqual(await db.checkpoint.findUnique({ where: { id: checkpoint.id } }), checkpoint);

    const race = await fixture();
    const racingId = race.a.id;
    const publish = async () => {
      for (let retry = 0; retry < 3; retry++) {
        const fresh = await get(racingId);
        const saved = await db.placementAttempt.updateMany({
          where: { id: racingId, updatedAt: fresh.updatedAt, review: { equals: json(fresh.review) } },
          data: { review: json({ ...(fresh.review as object), report: publication }), showResult: true },
        });
        if (saved.count) return;
      }
      assert.fail("The fixture publication did not persist");
    };
    const [racingDecision] = await Promise.all([writeManualCredit(racingId, actor, race.decision), publish()]);
    const published = await get(racingId);
    const publishedReview = published.review as { report: unknown; manualCredit?: unknown };
    assert.deepEqual(publishedReview.report, publication);
    assert.equal(Boolean(publishedReview.manualCredit), racingDecision === "saved");
    assert.deepEqual(published.state, race.a.state);
    assert.equal(await writeManualCredit(racingId, actor, { ...race.decision, id: "after-publication" }), "rejected");
    assert.deepEqual(await get(racingId), published);
    console.log("PASS PostgreSQL manual credit: teacher scope, duplicate and revoke, publication race, original response and Checkpoint unchanged");
  } finally {
    await db.user.delete({ where: { id: teacher.id } });
  }
}

main().finally(() => db.$disconnect());
