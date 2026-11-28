import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "../src/lib/db";
import { emptyState, type CoreItem, type ReadItem, type SpeakItem, type WriteItem } from "../src/lib/placement/engine";
import { confirmPlacementLevelForTeacher, placementLevelView } from "../src/lib/placement/level-confirmation";
import { RUB_V2 } from "../src/lib/placement/rubric";
import { json, stateOf } from "../src/lib/placement/run";
import { verifiedSpeakingSource } from "../src/lib/placement/speaking-recording-proof";
import { wsTeacherDecisionView, saveWsTeacherDecision } from "../src/lib/placement/ws-teacher-write";

const database = new URL(process.env.DATABASE_URL ?? "");
const origin = new URL(process.env.PT_LEVEL_FIXTURE_ORIGIN ?? "");
const uploads = process.env.UPLOAD_DIR ?? "";
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/pt_roadmap_writer_fixture");
assert.equal(origin.origin, "http://127.0.0.1:3089");
assert.match(uploads, /^\/tmp\/vibeon-pt36-synthetic-[^/]+$/);

const at = new Date("2026-11-28T10:00:00Z");
const base = { level: "B1", band: 0, topic_en: "Travel", topic_ru: "Поездки" } as const;
const writing: WriteItem = { ...base, id: "fixture-writing", type: "writing", skill: "writing", expects: [],
  prompt_en: "Describe a trip.", prompt_ru: "", min_words: 4, max_words: 100, time_min: 10 };
const speaking: SpeakItem = { ...base, id: "fixture-speaking", type: "speaking", skill: "speaking", expects: [],
  intro_ru: "", questions: [{ q: "Where did you go?", prep_sec: 10, speak_sec: 30 }, { q: "What did you see?", prep_sec: 10, speak_sec: 30 }] };
const grammar: CoreItem = { ...base, id: "fixture-grammar", skill: "grammar", type: "gap", topic_id: "g-b1-second-conditional",
  q: "Fixture grammar question", accept: ["key"], explain_ru: "" };
const reading: ReadItem = { ...base, id: "fixture-reading", type: "reading", skill: "reading", title: "Fixture reading", passage: "Fixture text",
  questions: [{ id: "fixture-question", q: "Fixture question", options: ["key", "wrong"], answer: 0, topic_id: "fixture-topic", explain_ru: "" }] };
const report = { sent: true, resultVisible: true, publications: [{ schema: 1, id: "fixture-report", sentAt: at.toISOString(), sheet: { input: { level: "A2" } } }] };
type Snapshot = { version: string; confirmedAt: string; level: string; topics: unknown[]; skills: { skill: string; status: string; reason?: string }[] };

function wav(sample: number) {
  const data = Buffer.alloc(444);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  data.writeInt16LE(sample, 44);
  return data;
}

async function main() {
  const user = (role: "TEACHER" | "STUDENT") => db.user.create({ data: {
    name: "Synthetic", email: `${randomUUID()}@example.invalid`, role,
    ...(role === "TEACHER" ? { teacherProfile: { create: { trialUntil: new Date("2099-01-01") } } } : {}),
  } });
  const teacher = await user("TEACHER"), outsider = await user("TEACHER"), studentUser = await user("STUDENT");
  const student = await db.student.create({ data: { teacherId: teacher.id, userId: studentUser.id, name: "Synthetic", level: "A2" } });
  const roadmap = await db.roadmap.create({ data: { studentId: student.id, type: "ge", goal: "B2", approvedAt: at, fromLevel: "A2",
    stages: [{ lvl: "A2", title: "Existing stage", hours: 2, points: [] }] } });
  const checkpoint = await db.checkpoint.create({ data: { studentId: student.id, roadmapId: roadmap.id, kind: "entry",
    source: "placement", status: "done", level: "A2", takenAt: at, results: { fixture: true } } });
  await db.lessonProgress.create({ data: { owner: `s:${student.id}`, templateId: "fixture-protected", state: "done" } });
  const protectedRows = () => Promise.all([
    db.student.findUnique({ where: { id: student.id } }), db.roadmap.findUnique({ where: { id: roadmap.id } }),
    db.checkpoint.findUnique({ where: { id: checkpoint.id } }), db.lessonProgress.findMany({ where: { owner: `s:${student.id}` } }),
  ]);
  const protection = await protectedRows();
  const studentToken = randomUUID(), teacherToken = randomUUID();
  for (const [userId, token] of [[studentUser.id, studentToken], [teacher.id, teacherToken]]) {
    await db.session.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } });
  }
  const state = { ...emptyState(), section: "speaking", parts: ["core", "reading", "writing", "speaking"],
    items: Object.fromEntries([grammar, reading, writing, speaking].map((item) => [item.id, item])),
    core: [{ id: grammar.id, ph: "d", step: 4 }], step: 4,
    reading: [reading.id], rdone: [reading.id],
    answers: { [grammar.id]: { v: "key", ok: true }, "fixture-question": { v: 1, ok: true } },
    writing: { id: writing.id, text: "Synthetic saved writing." }, speaking: { id: speaking.id, rec: {} } };
  const attempt = await db.placementAttempt.create({ data: { teacherId: teacher.id, studentId: student.id, checkpointId: checkpoint.id,
    token: randomUUID(), mode: "student", status: "active", level: "A2", showResult: true, review: json({ report }), state: json(state) } });
  const read = () => db.placementAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  const review = (row: Awaited<ReturnType<typeof read>>) => row.review as Record<string, unknown>;
  const snapshot = (row: Awaited<ReturnType<typeof read>>) => review(row).roadmapResultV1 as Snapshot | undefined;
  const upload = (taskId: string, sample: number) => {
    const body = new FormData();
    body.set("taskId", taskId);
    body.set("file", new File([new Uint8Array(wav(sample))], "fixture.wav", { type: "audio/wav" }));
    return fetch(new URL(`/api/placement/${attempt.id}/rec/1`, origin), {
      method: "POST", body, headers: { cookie: `vo_session=${studentToken}` },
    });
  };
  const submitFixture = async (submittedAt: Date) => {
    const fresh = await read();
    await db.placementAttempt.update({ where: { id: attempt.id }, data: {
      status: "submitted", submittedAt, state: json({ ...stateOf(fresh.state), section: "done" }),
    } });
  };
  const approve = async (kind: "writing" | "speaking") => {
    const view = wsTeacherDecisionView(await read(), kind)!;
    const marks = Object.fromEntries(RUB_V2[kind].map(({ id }) => [id, 4]));
    assert.equal(await saveWsTeacherDecision(attempt.id, teacher.id, kind, view.expected, { type: "confirm", marks }), "saved");
  };
  assert.equal((await upload("old-task", 0)).status, 409);
  assert.equal((await upload(speaking.id, 1)).status, 200);
  await submitFixture(at);
  await approve("writing");
  await approve("speaking");
  const before = await read();
  const currentState = stateOf(before.state);
  const proof = (review(before).speakingRecordingsV1 as Record<string, Record<string, unknown>>)["1"];
  assert.ok(await verifiedSpeakingSource(attempt.id, currentState, review(before)));
  assert.equal(await verifiedSpeakingSource(attempt.id, currentState, {}), undefined);
  assert.equal(await verifiedSpeakingSource("other-attempt", currentState, review(before)), undefined);
  for (const changed of [{ taskId: "old-task" }, { question: 2 }, { reference: "superseded|audio/wav" }]) {
    assert.equal(await verifiedSpeakingSource(attempt.id, currentState, { speakingRecordingsV1: { "1": { ...proof, ...changed } } }), undefined);
  }
  const filename = path.join(uploads, currentState.speaking!.rec["1"].split("|")[0]);
  const originalAudio = await readFile(filename);
  await rename(filename, filename + ".missing-test");
  assert.equal(await verifiedSpeakingSource(attempt.id, currentState, review(before)), undefined);
  await rename(filename + ".missing-test", filename);
  await writeFile(filename, wav(2));
  assert.equal(await verifiedSpeakingSource(attempt.id, currentState, review(before)), undefined);
  const unverified = (await placementLevelView(before, teacher.id))!;
  assert.deepEqual(unverified.facts.find(({ skill }) => skill === "speaking"), { factId: "speaking", skill: "speaking", status: "unknown", reason: "unknown-origin" });
  await writeFile(filename, originalAudio);
  assert.equal(snapshot(await read()), undefined);

  delete process.env.PL_ROADMAP_CONFIRM;
  assert.equal(await placementLevelView(before, teacher.id), null);
  process.env.PL_ROADMAP_CONFIRM = "1";
  const view = (await placementLevelView(before, teacher.id))!;
  assert.equal(await placementLevelView(before, outsider.id), null);
  assert.ok(view.suggestedLevel);
  assert.ok(view.facts.some((fact) => fact.skill === "reading" && fact.status === "unknown" && fact.reason === "unknown-origin"));
  const factIds = view.facts.flatMap((fact) => "selectable" in fact && fact.selectable ? [fact.factId] : []);
  const decision = { revision: view.revision, previousVersion: view.previousVersion, level: "B1" as const, factIds };
  assert.equal(await confirmPlacementLevelForTeacher(attempt.id, outsider.id, decision), "unavailable");
  assert.equal(await confirmPlacementLevelForTeacher(attempt.id, teacher.id, { ...decision, factIds: ["unverified"] }), "stale");

  if (process.env.PT_LEVEL_BROWSER_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.PT_LEVEL_BROWSER_MODULE).href);
    const browser = await chromium.launch({ executablePath: process.env.PT_LEVEL_BROWSER ?? "/usr/bin/chromium" });
    try {
      const context = await browser.newContext();
      await context.addCookies([{ name: "vo_session", value: teacherToken, url: origin.origin }, { name: "lang", value: "en", url: origin.origin }]);
      const page = await context.newPage();
      const response = await page.goto(new URL(`/teacher/placement/${attempt.id}`, origin).href);
      assert.equal(response?.status(), 200);
      assert.ok(!(await response!.text()).includes(String(proof.reference)));
      assert.equal(snapshot(await read()), undefined);
      const form = page.locator("form").filter({ hasText: "Confirmed level for the roadmap" });
      assert.doesNotMatch(await form.innerText(), /fixture-writing|Synthetic saved writing/);
      for (const box of await form.getByRole("checkbox").all()) await box.check();
      await form.getByRole("combobox").selectOption("B1");
      await form.getByRole("button", { name: "Confirm level and evidence" }).click();
      await form.getByText("The confirmed result was saved.").waitFor();
      await form.getByRole("button", { name: "Confirm level and evidence" }).click();
      await form.getByText("The confirmed result was saved.").waitFor();
      console.log("PASS teacher browser action confirms selected facts through the normal server action");
    } finally {
      await browser.close();
    }
  } else {
    assert.equal(await confirmPlacementLevelForTeacher(attempt.id, teacher.id, decision), "saved");
  }
  const saved = (await read()), first = snapshot(saved)!;
  assert.equal(first.level, "B1");
  assert.deepEqual(first.skills.filter(({ status }) => status === "checked").map(({ skill }) => skill), ["grammar", "writing", "speaking"]);
  assert.equal(first.topics.length, 1);
  assert.ok(first.skills.some((fact) => fact.skill === "reading" && fact.reason === "unknown-origin"));
  assert.equal(await confirmPlacementLevelForTeacher(attempt.id, teacher.id, decision), "unchanged");
  assert.deepEqual(snapshot(await read()), first);
  assert.equal(saved.level, before.level);
  assert.deepEqual(review(saved).report, report);
  assert.deepEqual(await protectedRows(), protection);

  if (process.env.PT_LEVEL_ROADMAP_READER) {
    const { loadPlacementProposal } = await import(pathToFileURL(process.env.PT_LEVEL_ROADMAP_READER).href);
    const actual = await loadPlacementProposal(roadmap, teacher.id, db);
    assert.deepEqual(actual?.preview.source, first);
    console.log("PASS Roadmap reader loaded the persisted handoff and its version");
  }

  await db.placementAttempt.update({ where: { id: attempt.id }, data: { status: "active", state: json({ ...currentState, section: "speaking" }) } });
  assert.equal((await upload(speaking.id, 3)).status, 200);
  await submitFixture(new Date(at.getTime() + 60000));
  assert.deepEqual(snapshot(await read()), first);
  assert.equal(await confirmPlacementLevelForTeacher(attempt.id, teacher.id, decision), "stale");
  await approve("speaking");
  const next = (await placementLevelView(await read(), teacher.id))!;
  assert.equal(next.previousVersion, first.version);
  assert.equal(await confirmPlacementLevelForTeacher(attempt.id, teacher.id,
    { ...decision, revision: next.revision, previousVersion: next.previousVersion }), "saved");
  const updated = await read();
  assert.notEqual(snapshot(updated)?.version, first.version);
  assert.deepEqual(review(updated).report, report);
  assert.deepEqual(await protectedRows(), protection);
  console.log("PASS upload provenance, historical gaps, explicit confirmation, repeat, stale submission, new version and protected data");
}

main().finally(() => db.$disconnect());
