import assert from "node:assert/strict";
import { emptyState, type SpeakItem, type WriteItem } from "../src/lib/placement/engine";
import { publicationStamp, storedReport } from "../src/lib/placement/report-publication";
import { RUB_V1, RUB_V2 } from "../src/lib/placement/rubric";
import { teacherReview } from "../src/lib/placement/teacher-review";
import { readWsAssessment, updateWsAssessment, wsAssessmentSource } from "../src/lib/placement/ws-assessment";

const base = { level: "B1", band: 0, topic_en: "Travel", topic_ru: "Поездки" } as const;
const write: WriteItem = {
  ...base, expects: [], id: "write-1", type: "writing", skill: "writing",
  prompt_en: "Describe a trip.", prompt_ru: "Опишите поездку.", min_words: 80, max_words: 100, time_min: 10,
};
const speak: SpeakItem = {
  ...base, expects: [], id: "speak-1", type: "speaking", skill: "speaking", intro_ru: "Расскажите о поездке.",
  questions: [{ q: "Where did you go?", prep_sec: 10, speak_sec: 30 }, { q: "What did you see?", prep_sec: 10, speak_sec: 30 }],
};
const state = {
  ...emptyState(), items: { [write.id]: write, [speak.id]: speak },
  writing: { id: write.id, text: "I visited the city." },
  speaking: { id: speak.id, rec: { "2": "fixture-second.ogg|audio/ogg", "1": "fixture-first.ogg|audio/ogg" } },
};
const at = "2026-11-28T08:00:00.000Z";
const legacy = {
  rubric: 1, writing: { task: 2 }, speaking: { fluency: 3 }, comment: "Прежняя оценка.",
  report: { sent: true, sentAt: at, publications: [{ id: "published-v1" }] },
};
const asAttempt = (review: unknown) => ({ review, level: "B1", reviewedAt: new Date(at) });
const writing = wsAssessmentSource(state, "writing", RUB_V2);
const speaking = wsAssessmentSource(state, "speaking", RUB_V2);
const marks = (kind: "writing" | "speaking", score: number) => Object.fromEntries(RUB_V2[kind].map(({ id }) => [id, score]));
const teacher = { marks: marks("writing", 4), teacherId: "fixture-teacher", at, note: "Комментарий преподавателя." };
const ai = { scores: marks("writing", 1), why: {}, summary: "Синтетический ответ." };
const speechAi = { ...ai, scores: { ...marks("speaking", 2), pronunciation: null } };
const apply = updateWsAssessment;
const get = readWsAssessment;

assert.equal(get(legacy, writing).confirmation, null);
assert.equal(get(legacy, speaking).draft, null);
assert.equal(get(legacy, writing).generation, null);
const withBoth = apply(apply(legacy, writing, { type: "sync" }), speaking, { type: "sync" });
assert.equal(apply(withBoth, writing, { type: "sync" }), withBoth);
const pending = apply(withBoth, writing, { type: "request", generation: 1, id: "late-writing", previousId: null });
const withSpeech = apply(
  apply(pending, speaking, { type: "request", generation: 1, id: "speaking-draft", previousId: null }),
  speaking, { type: "result", generation: 1, id: "speaking-draft", score: speechAi, at },
);
assert.equal(withSpeech.speaking, legacy.speaking);
assert.equal(get(withSpeech, speaking).draft?.score.scores.pronunciation, null);
assert.equal(apply(withSpeech, writing, { type: "confirm", generation: 1, confirmation: { ...teacher, marks: {} } }), withSpeech);
const confirmed = apply(withSpeech, writing, { type: "confirm", generation: 1, confirmation: teacher });
assert.deepEqual(get(confirmed, writing).confirmation, teacher);
assert.deepEqual(get(confirmed, speaking), get(withSpeech, speaking));
assert.equal(get(confirmed, speaking).confirmation, null);
const late = apply(confirmed, writing, { type: "result", generation: 1, id: "late-writing", score: ai, at });
assert.equal(late, confirmed);
assert.equal(get(late, writing).draft, null);
const speechTeacher = { ...teacher, marks: marks("speaking", 3) };
const bothConfirmed = apply(late, speaking, { type: "confirm", generation: 1, confirmation: speechTeacher });
assert.deepEqual(get(bothConfirmed, writing), get(late, writing));
assert.deepEqual(get(bothConfirmed, speaking).confirmation, speechTeacher);
assert.deepEqual(get(bothConfirmed, speaking).draft?.score, speechAi);

const changedWriting = wsAssessmentSource({ ...state, writing: { ...state.writing, text: "I visited another city." } }, "writing", RUB_V2);
const oldResult = { type: "result", generation: 1, id: "late-writing", score: ai, at } as const;
assert.equal(apply(pending, changedWriting, oldResult), pending);
const changedWhilePending = apply(pending, changedWriting, { type: "sync" });
assert.equal(apply(changedWhilePending, changedWriting, oldResult), changedWhilePending);
assert.deepEqual(get(bothConfirmed, changedWriting).staleConfirmation, teacher);
assert.equal(get(bothConfirmed, changedWriting).confirmation, null);
assert.equal(apply(bothConfirmed, changedWriting, { type: "confirm", generation: 1, confirmation: teacher }), bothConfirmed);
const newWriting = apply(bothConfirmed, changedWriting, { type: "sync" });
assert.equal(get(newWriting, changedWriting).generation, 2);
assert.deepEqual(get(newWriting, changedWriting).history[0].confirmation, teacher);
assert.deepEqual(get(newWriting, speaking), get(bothConfirmed, speaking));
const revertedWriting = apply(newWriting, writing, { type: "sync" });
assert.equal(get(revertedWriting, writing).generation, 3);
assert.equal(get(revertedWriting, writing).confirmation, null);
assert.deepEqual(get(revertedWriting, writing).staleConfirmation, teacher);

const reordered = wsAssessmentSource({ ...state, speaking: { ...state.speaking, rec: { "1": state.speaking.rec["1"], "2": state.speaking.rec["2"] } } }, "speaking", RUB_V2);
assert.equal(reordered.fingerprint, speaking.fingerprint);
const rerecorded = wsAssessmentSource({ ...state, speaking: { ...state.speaking, rec: { ...state.speaking.rec, "2": "replacement.ogg|audio/ogg" } } }, "speaking", RUB_V2);
const newSpeech = apply(bothConfirmed, rerecorded, { type: "sync" });
assert.deepEqual(get(newSpeech, rerecorded).staleConfirmation, speechTeacher);
assert.equal(get(newSpeech, rerecorded).confirmation, null);
assert.equal(get(newSpeech, rerecorded).draft, null);
assert.deepEqual(get(newSpeech, writing), get(bothConfirmed, writing));
const emptySpeech = wsAssessmentSource({ ...state, speaking: { ...state.speaking, rec: {} } }, "speaking", RUB_V2);
const empty = apply(newSpeech, emptySpeech, { type: "sync" });
assert.equal(get(empty, emptySpeech).generation, 3);
assert.equal(apply(empty, emptySpeech, { type: "request", generation: 3, id: "empty", previousId: null }), empty);
assert.equal(apply(empty, emptySpeech, { type: "confirm", generation: 3, confirmation: speechTeacher }), empty);
const missingTask = wsAssessmentSource(emptyState(), "speaking", RUB_V2);
assert.equal(apply(legacy, missingTask, { type: "sync" }), legacy);
assert.deepEqual(get(bothConfirmed, missingTask).staleConfirmation, speechTeacher);
assert.notEqual(wsAssessmentSource(state, "writing", RUB_V1).fingerprint, writing.fingerprint);
const revisedTask = wsAssessmentSource({ ...state, items: { ...state.items, [write.id]: { ...write, prompt_en: "Describe a different trip." } } }, "writing", RUB_V2);
assert.deepEqual(get(bothConfirmed, revisedTask).staleConfirmation, teacher);

const reopened = apply(bothConfirmed, writing, { type: "reopen", generation: 1 });
assert.equal(get(reopened, writing).generation, 2);
assert.equal(get(reopened, writing).confirmation, null);
assert.equal(get(reopened, writing).staleConfirmation, null);
assert.equal(get(reopened, writing).history[0].reason, "reopened");
assert.equal(apply(reopened, writing, { type: "result", generation: 1, id: "late-writing", score: ai, at }), reopened);
assert.deepEqual(get(reopened, speaking), get(bothConfirmed, speaking));

const first = { type: "request", generation: 2, id: "first", previousId: null } as const;
const running = apply(reopened, writing, first);
assert.equal(apply(running, writing, first), running);
const failed = apply(running, writing, { type: "failure", generation: 2, id: "first" });
assert.equal(get(failed, writing).request?.status, "failed");
assert.equal(get(failed, writing).draft, null);
const retry = apply(failed, writing, { type: "request", generation: 2, id: "retry", previousId: "first" });
assert.equal(apply(retry, writing, first), retry);
assert.equal(apply(retry, writing, { type: "result", generation: 2, id: "first", score: ai, at }), retry);
const retryResult = { type: "result", generation: 2, id: "retry", score: ai, at } as const;
const aiDraft = apply(retry, writing, retryResult);
assert.deepEqual(get(aiDraft, writing).draft?.score, ai);
assert.equal(apply(aiDraft, writing, retryResult), aiDraft);
assert.equal(get(aiDraft, writing).confirmation, null);
assert.deepEqual(get(aiDraft, speaking), get(bothConfirmed, speaking));
const another = apply(aiDraft, writing, { type: "request", generation: 2, id: "another", previousId: "retry" });
const anotherFailure = apply(another, writing, { type: "failure", generation: 2, id: "another" });
assert.deepEqual(get(anotherFailure, writing).draft, get(aiDraft, writing).draft);

const restored = JSON.parse(JSON.stringify(aiDraft)) as Record<string, unknown>;
assert.deepEqual(get(restored, writing), get(aiDraft, writing));
assert.deepEqual(get(restored, speaking), get(aiDraft, speaking));
assert.deepEqual(Object.fromEntries(Object.entries(restored).filter(([key]) => key !== "wsAssessment")), legacy);
assert.deepEqual(publicationStamp(storedReport(restored)), publicationStamp(storedReport(legacy)));
assert.deepEqual(storedReport(restored), storedReport(legacy));
assert.deepEqual(teacherReview(asAttempt(restored)).active.legacyReview, teacherReview(asAttempt(legacy)).active.legacyReview);
const future = { ...legacy, wsAssessment: { schema: 2 } };
assert.equal(apply(future, writing, { type: "sync" }), future);
console.log("PASS Placement Writing/Speaking: skill isolation, stale answers/tasks/rubrics, late and duplicate AI, retry, reopen, empty audio, legacy and published report");
