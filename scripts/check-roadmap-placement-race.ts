import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Prisma } from "@prisma/client";
import type { Stage } from "../src/lib/roadmap/cefr";
import { itemsFor } from "../src/lib/roadmap/testbank";

const url = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/vibeon_pt35_review",
  "Use a dedicated local PostgreSQL database named vibeon_pt35_review");

const require = createRequire(import.meta.url);
function stub(module: string, exports: unknown) {
  const id = require.resolve(module);
  require.cache[id] = { exports } as NodeModule;
}
const session = new AsyncLocalStorage<{
  id: string; role: "TEACHER" | "STUDENT"; beforeAuth?: () => Promise<void>;
}>();
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
const enteredGrading = barrier();
const finishGrading = barrier();
stub("next/cache", { revalidatePath: () => undefined });
stub("../src/lib/auth/session", {
  requireUser: async (role: "TEACHER" | "STUDENT") => {
    const user = session.getStore();
    assert.ok(user && user.role === role);
    await user.beforeAuth?.();
    return user;
  },
});
stub("../src/lib/i18n/server", { getT: async () => ({ lang: "ru" }) });
stub("../src/lib/ai/ctx", { aiCtx: async () => ({}) });
stub("../src/lib/ai/gateway", {
  run: async () => {
    enteredGrading.release(); // The real submit action has already loaded the old Roadmap.
    await finishGrading.promise;
    return { notes: [] };
  },
});
const notified: unknown[] = [];
stub("../src/lib/notify", { notify: async (notification: unknown) => { notified.push(notification); } });
const { db } = require("../src/lib/db") as typeof import("../src/lib/db");
const { editStage, manualResults, submitTest } = require("../src/lib/roadmap/actions") as typeof import("../src/lib/roadmap/actions");
const { confirmPlacementProposal } = require("../src/lib/roadmap/placement-proposal-actions") as typeof import("../src/lib/roadmap/placement-proposal-actions");
const { loadPlacementProposal } = require("../src/lib/roadmap/placement-proposal-data") as typeof import("../src/lib/roadmap/placement-proposal-data");

const point = (id: string, topic: string) => ({ id, title: id, level: "B1", hours: 2, why: "", focus: "", topics: [topic] });
const stage = (title: string, points: NonNullable<Stage["points"]>): Stage => ({
  lvl: "B1", title, hours: points.length * 2, points, grammar: points.map((p) => p.title), vocabulary: [], skills: [],
});
const secure = "g-b1-passive-basic", gap = "g-b1-second-conditional";
const original = [
  { ...stage("Past", [point("past", "g-a2-past-simple")]), passed: { score: 85, at: "2026-11-25T10:00:00Z" } },
  { ...stage("Current", [point("current", "g-b1-past-perfect")]), checkpoint: { tests: ["grammar"], pass_rule: "70%" } },
  stage("Future", [point("secure", secure), point("gap", gap)]),
];
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const correct = Object.fromEntries(itemsFor("slice", "B1").map((item) => [item.id, item.answer]));
const writing = "Practice helps us learn by giving us opportunities to review and apply what we already know in new situations every day with supportive teachers and classmates who are learning alongside us.";

async function main() {
  const key = randomUUID();
  const teacher = await db.user.create({
    data: { email: `teacher-${key}@example.test`, name: "Synthetic teacher", role: "TEACHER", teacherProfile: { create: {} } },
  });
  try {
    const pupil = await db.user.create({ data: { email: `student-${key}@example.test`, name: "Synthetic student", role: "STUDENT" } });
    try {
      const student = await db.student.create({ data: { teacherId: teacher.id, userId: pupil.id, name: pupil.name } });
      const initial = await db.roadmap.create({
        data: {
          studentId: student.id, type: "ge", goal: "B2", courseIds: [], stages: json(original), startHours: 2.5,
          approvedAt: new Date("2026-11-23T09:00:00Z"), builtAt: new Date("2026-11-23T08:00:00Z"),
        },
      });
      const checkpoint = await db.checkpoint.create({ data: { studentId: student.id, roadmapId: initial.id, kind: "slice", stage: 1 } });
      const placement = await db.placementAttempt.create({
        data: { teacherId: teacher.id, studentId: student.id, mode: "student", token: key },
      });
      const handoff = {
        attemptId: placement.id, version: "v1", confirmedAt: "2026-11-27T10:00:00Z", level: "B1", skills: [],
        topics: [secure, gap].map((topicId) => ({
          status: "checked", topicId, verdict: topicId === gap ? "gap" : "secure", correct: topicId === gap ? 1 : 4, total: 4,
          provenance: { scope: "initial", evidenceId: topicId },
        })),
      };
      const setVersion = (version: string) => db.placementAttempt.update({
        where: { id: placement.id }, data: { review: json({ roadmapResultV1: { ...handoff, version } }) },
      });
      const route = () => db.roadmap.findUniqueOrThrow({ where: { id: initial.id } });
      const proposal = async () => {
        const result = await loadPlacementProposal(await route(), teacher.id);
        assert.ok(result);
        return result.preview;
      };
      const asTeacher = <T>(f: () => T) => session.run({ id: teacher.id, role: "TEACHER" }, f);
      const asStudent = <T>(f: () => T) => session.run({ id: pupil.id, role: "STUDENT" }, f);
      const confirm = (expected: Awaited<ReturnType<typeof proposal>>["confirmation"]) =>
        asTeacher(() => confirmPlacementProposal(student.id, initial.id, expected));
      const xmin = async () => {
        const [row] = await db.$queryRaw<{ version: string }[]>`SELECT xmin::text AS version FROM "Roadmap" WHERE id = ${initial.id}`;
        return row.version;
      };
      await setVersion("v1");
      const first = await proposal();
      assert.equal(first.changes.length, 1);

      const submitting = asStudent(() => submitTest(checkpoint.id, correct, writing));
      const enteredEdit = barrier(), finishEdit = barrier();
      const oldEdit = session.run({
        id: teacher.id, role: "TEACHER",
        beforeAuth: () => { enteredEdit.release(); return finishEdit.promise; },
      }, () => editStage(initial.id, 1, { title: "Old edit" }));
      try {
        await Promise.all([
          Promise.race([enteredGrading.promise, submitting.then(() => { throw new Error("The test finished before grading started"); })]),
          Promise.race([enteredEdit.promise, oldEdit.then(() => { throw new Error("The edit finished before authentication"); })]),
        ]);
        assert.equal(await confirm(first.confirmation), "applied");
        assert.deepEqual(await asTeacher(() => editStage(initial.id, 1, { title: "Current edited" })), { ok: true });
        const beforeEdit = await xmin();
        finishEdit.release();
        assert.deepEqual(await oldEdit, { ok: false, error: "Маршрут изменился. Обновите страницу и повторите." });
        assert.equal(await xmin(), beforeEdit);
      } finally {
        finishEdit.release();
        finishGrading.release();
        await Promise.all([submitting, oldEdit]);
      }
      assert.equal((await submitting).ok, true);
      const after = await route();
      const savedStages = after.stages as Stage[];
      const completed = await db.checkpoint.findUniqueOrThrow({ where: { id: checkpoint.id } });
      assert.equal(completed.status, "done");
      assert.equal(completed.stage, 1);
      assert.equal(completed.roadmapId, initial.id);
      assert.equal((completed.results as { score: number }).score, 100);
      assert.deepEqual(savedStages[0], original[0]);
      assert.deepEqual(savedStages[1], { ...original[1], title: "Current edited", passed: { score: 100, at: completed.takenAt!.toISOString() } });
      assert.deepEqual(savedStages[2].points?.map((p) => p.id), ["gap", "secure"]);
      assert.deepEqual(after.approvedAt, initial.approvedAt);
      assert.equal((await asStudent(() => submitTest(checkpoint.id, {}, ""))).ok, true);
      assert.deepEqual(await db.checkpoint.findUniqueOrThrow({ where: { id: checkpoint.id } }), completed);
      assert.equal(notified.length, 1);

      // Reset only the synthetic future stage to exercise the normal external result flow.
      await db.roadmap.update({ where: { id: initial.id }, data: { stages: json([savedStages[0], savedStages[1], original[2]]) } });
      assert.deepEqual(await asTeacher(() => manualResults(student.id, "slice", "B1", { grammar: 76 })), { ok: true });
      const external = await db.checkpoint.findFirstOrThrow({ where: { studentId: student.id, source: "manual" } });
      assert.equal(external.stage, null);
      assert.equal(external.status, "done");
      const unresolved = await db.checkpoint.create({ data: { studentId: student.id, roadmapId: initial.id, kind: "slice" } });
      assert.equal((await proposal()).blockedBy, "checkpoint");
      await db.checkpoint.delete({ where: { id: unresolved.id } });
      const v1 = await proposal();
      assert.equal(v1.changes.length, 1);
      await setVersion("v2");
      const beforeStale = await xmin();
      assert.equal(await confirm(v1.confirmation), "stale");
      assert.equal(await xmin(), beforeStale);
      const v2 = await proposal();
      assert.equal(await confirm(v2.confirmation), "applied");
      const afterApply = await xmin();
      assert.equal(await confirm(v2.confirmation), "already-applied");
      assert.equal(await xmin(), afterApply);
      assert.deepEqual(await db.checkpoint.findUniqueOrThrow({ where: { id: external.id } }), external);
      assert.deepEqual(await db.checkpoint.findUniqueOrThrow({ where: { id: checkpoint.id } }), completed);
      console.log("PASS PostgreSQL: stalled submission + proposal + teacher edit; external slice without stage; stale revision and duplicate without writes");
    } finally {
      await db.user.delete({ where: { id: pupil.id } });
    }
  } finally {
    await db.user.delete({ where: { id: teacher.id } });
  }
}

main().finally(() => db.$disconnect()).catch((error) => { console.error(error); process.exitCode = 1; });
