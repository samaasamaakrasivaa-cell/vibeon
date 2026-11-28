import assert from "node:assert/strict";
import { test } from "node:test";
import { draftHomeworkFeedback } from "../src/lib/homework-feedback-draft";

const target = { lessonId: "lesson-a", studentId: "pupil-a" };
const tasks = [{ id: "translation", title: "Перевод" }, { id: "transform", title: "Преобразование" }];
const translation = {
  ...target,
  taskId: "translation",
  status: "NEEDS_REVIEW",
  payload: { val: { 0: "She goes to school." }, gnotes: "private-note" },
  archivedPayloads: [{ val: { 0: "She go to school." }, corr: { 0: "private-correction" } }],
};

test("uses only assigned answers from the requested pupil and lesson", () => {
  const draft = draftHomeworkFeedback(target, tasks, [
    translation,
    { ...translation, studentId: "pupil-b", payload: { text: "other-pupil" } },
    { ...translation, lessonId: "lesson-b", payload: { text: "other-lesson" } },
    { ...translation, taskId: "unassigned", payload: { text: "unassigned-answer" } },
  ], "ru");
  assert.equal(draft, "«Перевод» — в одной из прошлых попыток «She go to school.», в последнем сданном ответе «She goes to school.».");
});

test("uses saved attempt history while excluding unfinished edits and private fields", () => {
  assert.match(draftHomeworkFeedback(target, tasks, [{
    ...translation,
    status: "DRAFT",
    payload: { val: { 0: "unfinished" }, hist: { 0: [{ v: "unfinished-edit" }] } },
  }], "en"), /^An earlier attempt at “Перевод” included “She go to school\.”\.$/);
});

test("describes recorded self-correction without judging an answer", () => {
  assert.equal(draftHomeworkFeedback(target, tasks, [{
    ...translation,
    taskId: "transform",
    payload: {
      val: { 0: "They were ready." },
      hist: { 0: [{ v: "They was ready.", ok: false }] },
      rounds: [{ by: "teacher", p: { text: "teacher-input" } }],
    },
    archivedPayloads: [],
  }], "en"), "“Преобразование” included “They was ready.” in an earlier attempt and “They were ready.” in the latest submitted answer.");
});

test("returns an empty draft when the only available work is unfinished", () => {
  assert.equal(draftHomeworkFeedback(target, tasks, [{
    ...translation, status: "DRAFT", archivedPayloads: [],
  }], "ru"), "");
});

test("compares the same answer field across attempts", () => {
  const draft = draftHomeworkFeedback(target, tasks, [{
    ...translation,
    payload: { val: { 0: "First line", 1: "Updated second line" } },
    archivedPayloads: [{ val: { 0: "First line", 1: "Earlier second line" } }],
  }], "en");
  assert.equal(draft, "“Перевод” included “Earlier second line” in an earlier attempt and “Updated second line” in the latest submitted answer.");
});
