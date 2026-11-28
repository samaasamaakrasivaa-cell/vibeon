import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { emptyState, type SpeakItem, type WriteItem } from "../src/lib/placement/engine";
import { RUB_V2 } from "../src/lib/placement/rubric";
import { json } from "../src/lib/placement/run";
import { readWsAssessment, wsAssessmentSource } from "../src/lib/placement/ws-assessment";
import { saveWsTeacherDecision } from "../src/lib/placement/ws-teacher-write";
import { requestWsWritingDraft } from "../src/lib/placement/ws-writing-draft";
import { saveFile } from "../src/lib/storage";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/pt_ws_teacher_fixture");
assert.match(process.env.UPLOAD_DIR ?? "", /^\/tmp\/vibeon-pt08-fixture-[^/]+$/);

const base = { level: "B1", band: 0, topic_en: "Travel", topic_ru: "Поездки", expects: [] } as const;
const writing: WriteItem = {
  ...base, expects: [], id: "fixture-writing", type: "writing", skill: "writing",
  prompt_en: "Describe a trip.", prompt_ru: "Опишите поездку.", min_words: 20, max_words: 100, time_min: 10,
};
const speaking: SpeakItem = {
  ...base, expects: [], id: "fixture-speaking", type: "speaking", skill: "speaking", intro_ru: "Расскажите о поездке.",
  questions: [{ q: "Where did you go?", prep_sec: 10, speak_sec: 30 }, { q: "Why?", prep_sec: 10, speak_sec: 30 }],
};
const marks = (kind: "writing" | "speaking") => Object.fromEntries(RUB_V2[kind].map(({ id }) => [id, 3]));
const teacherId = "fixture-teacher";
const submittedAt = new Date("2026-11-28T10:00:00.000Z");

async function main() {
  const key = await saveFile(Buffer.from("synthetic storage fixture"), "audio/ogg");
  const state = {
    ...emptyState(), section: "done" as const, items: { [writing.id]: writing, [speaking.id]: speaking },
    writing: { id: writing.id, text: "I went to London." }, speaking: { id: speaking.id, rec: { "1": key + "|audio/ogg" } },
  };
  const report = { publications: [{ id: "fixture-publication" }], sent: true, sentAt: submittedAt.toISOString() };
  const legacy = { rubric: 1, writing: { task: 1 }, speaking: { fluency: 2 }, report };
  const { id } = await db.placementAttempt.create({
    data: { teacherId, token: randomUUID(), mode: "link", status: "reviewed", submittedAt, level: "A2", showResult: true, state: json(state), review: legacy },
  });
  const read = () => db.placementAttempt.findUniqueOrThrow({ where: { id } });
  const asReview = (review: unknown) => review as Record<string, unknown>;
  const source = (kind: "writing" | "speaking", generation: number | null = null, current = state) => ({
    source: wsAssessmentSource(current, kind, RUB_V2).fingerprint!, generation, submittedAt: submittedAt.toISOString(),
  });
  const confirm = (kind: "writing" | "speaking") => ({ type: "confirm", marks: marks(kind) } as const);

  try {
    const initial = await read();
    delete process.env.PL_WS_TEACHER_WRITE;
    assert.equal(await saveWsTeacherDecision(id, teacherId, "writing", source("writing"), confirm("writing")), "disabled");
    process.env.PL_WS_TEACHER_WRITE = "1";
    assert.equal(await saveWsTeacherDecision(id, "other-teacher", "writing", source("writing"), confirm("writing")), "not-found");
    assert.equal(await saveWsTeacherDecision(id, teacherId, "writing", source("writing"), { type: "confirm", marks: {} }), "rejected");
    assert.deepEqual(await read(), initial);

    const save = await Promise.all([
      saveWsTeacherDecision(id, teacherId, "writing", source("writing"), confirm("writing")),
      saveWsTeacherDecision(id, teacherId, "speaking", source("speaking"), confirm("speaking")),
    ]);
    assert.deepEqual(save, ["saved", "saved"]);
    const both = await read();
    const bothReview = asReview(both.review);
    const writingSource = wsAssessmentSource(state, "writing", RUB_V2), speakingSource = wsAssessmentSource(state, "speaking", RUB_V2);
    assert.deepEqual(readWsAssessment(bothReview, writingSource).confirmation?.marks, marks("writing"));
    assert.deepEqual(readWsAssessment(bothReview, speakingSource).confirmation?.marks, marks("speaking"));
    assert.deepEqual(bothReview.report, report);
    assert.deepEqual(bothReview.writing, legacy.writing);
    assert.deepEqual(bothReview.speaking, legacy.speaking);
    assert.deepEqual(both.state, initial.state);
    assert.equal(both.level, initial.level);
    assert.equal(both.showResult, initial.showResult);
    assert.equal(both.status, initial.status);

    const reopen = () => saveWsTeacherDecision(id, teacherId, "writing", source("writing", 1), { type: "reopen" });
    assert.deepEqual((await Promise.all([reopen(), reopen()])).sort(), ["saved", "stale"]);
    const reopened = asReview((await read()).review);
    assert.equal(readWsAssessment(reopened, writingSource).history.length, 1);
    assert.deepEqual(readWsAssessment(reopened, speakingSource), readWsAssessment(bothReview, speakingSource));

    const missingAudio = { ...state, speaking: { ...state.speaking, rec: { "1": "missing.ogg|audio/ogg" } } };
    await db.placementAttempt.update({ where: { id }, data: { state: json(missingAudio) } });
    const prior = await read();
    assert.equal(await saveWsTeacherDecision(id, teacherId, "speaking", source("speaking", 1), { type: "reopen" }), "stale");
    assert.equal(await saveWsTeacherDecision(id, teacherId, "speaking", source("speaking", null, missingAudio), confirm("speaking")), "empty");
    assert.deepEqual(await read(), prior);
    console.log("PASS teacher Writing/Speaking persistence: flag, owner, rubric, parallel confirmation, single reopening, missing and replaced audio, legacy review and report preservation");
    const originalWriting = { ...source("writing", 2), requestSequence: null };
    const draft = { scores: marks("writing"), why: {}, summary: "Synthetic draft" };
    assert.equal(await requestWsWritingDraft(id, "other-teacher", originalWriting, async () => {
      assert.fail("Do not request scoring for another teacher");
    }), "stale");
    assert.equal(await requestWsWritingDraft(id, teacherId, originalWriting, async () => { throw new Error("fixture failure"); }), "failed");
    const writingAfterFailure = readWsAssessment(asReview((await read()).review), writingSource);
    assert.equal(writingAfterFailure.request?.status, "failed");

    let started!: () => void;
    const modelStarted = new Promise<void>((resolve) => { started = resolve; });
    let completeModel!: () => void;
    const modelResult = new Promise<void>((resolve) => { completeModel = resolve; });
    const pendingDraft = requestWsWritingDraft(id, teacherId, { ...originalWriting, requestSequence: 1 }, async (input) => {
      assert.deepEqual(input.answers, [state.writing.text]);
      started();
      await modelResult;
      return draft;
    });
    await modelStarted;
    assert.equal(await saveWsTeacherDecision(id, teacherId, "writing", source("writing", 2), confirm("writing")), "saved");
    completeModel();
    assert.equal(await pendingDraft, "stale");
    const afterLateResponse = asReview((await read()).review);
    assert.equal(readWsAssessment(afterLateResponse, writingSource).draft, null);
    assert.ok(readWsAssessment(afterLateResponse, writingSource).confirmation);
    assert.deepEqual(afterLateResponse.report, report);

    assert.equal(await saveWsTeacherDecision(id, teacherId, "writing", source("writing", 2), { type: "reopen" }), "saved");
    assert.equal(await requestWsWritingDraft(id, teacherId, { ...source("writing", 3), requestSequence: null }, async () => draft), "saved");
    const aiReview = asReview((await read()).review);
    assert.deepEqual(readWsAssessment(aiReview, writingSource).draft?.score, draft);
    assert.equal(readWsAssessment(aiReview, writingSource).confirmation, null);
    assert.deepEqual(aiReview.writing, legacy.writing);
    console.log("PASS Writing AI storage: owner, failure, late model response after confirmation, and separate draft persistence");

    if (process.env.WS_TEACHER_FIXTURE_ORIGIN) {
      const origin = new URL(process.env.WS_TEACHER_FIXTURE_ORIGIN);
      assert.equal(origin.hostname, "127.0.0.1");
      assert.equal(origin.protocol, "http:");
      const token = randomUUID();
      await db.placementAttempt.update({ where: { id }, data: { token, status: "active", state: json({ ...state, section: "speaking" }) } });
      const upload = (question: number, taskId: string) => {
        const form = new FormData();
        form.set("taskId", taskId);
        form.set("file", new File([new Uint8Array(256)], "fixture.ogg", { type: "audio/ogg" }));
        return fetch(new URL(`/api/placement/${id}/rec/${question}`, origin), {
          method: "POST", body: form, headers: { cookie: `vo_pt_${id}=${token}` },
        });
      };
      assert.equal((await upload(1, "previous-task")).status, 409);
      const responses = await Promise.all([upload(1, speaking.id), upload(2, speaking.id)]);
      assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
      const uploaded = await read();
      const updatedState = uploaded.state as typeof state;
      assert.deepEqual(Object.keys(updatedState.speaking.rec).sort(), ["1", "2"]);
      assert.notEqual(updatedState.speaking.rec["1"], state.speaking.rec["1"]);
      const updatedReview = asReview(uploaded.review);
      const newSource = wsAssessmentSource(updatedState, "speaking", RUB_V2);
      const newAssessment = readWsAssessment(updatedReview, newSource);
      assert.equal(newAssessment.confirmation, null);
      assert.ok(newAssessment.staleConfirmation);
      assert.equal(newAssessment.history.length, 1);
      assert.deepEqual(readWsAssessment(updatedReview, writingSource), readWsAssessment(aiReview, writingSource));
      assert.deepEqual(updatedReview.report, report);
      console.log("PASS HTTP upload: wrong task rejected, parallel distinct questions preserved, Speaking revision and history updated atomically");
    }
  } finally {
    await db.placementAttempt.delete({ where: { id } });
  }
}

main().finally(() => db.$disconnect());
