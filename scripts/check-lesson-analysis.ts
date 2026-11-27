// npx tsx scripts/check-lesson-analysis.ts
import assert from "node:assert/strict";
import { LESSON_ANALYSIS_ESTIMATE_RUB, LESSON_ANALYSIS_MONTHLY_LIMIT, lessonAnalysisInput, parseLessonPractice } from "../src/lib/ai/lesson-analysis-plan";
import { hasRecordedWork, lessonEvidenceTotals, lessonModelEvidence, lessonTaskEvidence } from "../src/lib/lessons/analysis-facts";

const topicId = "g-a1-present-simple";
const testTask = {
  id: "checked-test",
  type: "test",
  title: "Synthetic quiz title",
  content: "1. Pick A.\nA*\nB\n\n2. Pick B.\nA\nB*\n\n3. Pick C.\nC*\nD",
  section: "lesson",
  options: { checkMode: "button", tags: { topic: topicId, skill: "grammar", words: ["synthetic vocabulary"] } },
};
const textTask = {
  id: "read-together",
  type: "text",
  title: "Synthetic reading title",
  content: "Synthetic reading passage.",
  section: "lesson",
  options: { tags: { skill: "reading", topicName: "Synthetic custom topic" } },
};

const [firstOption] = lessonTaskEvidence([testTask], [
  { taskId: testTask.id, lessonMs: 0, payload: { checked: true, ans: { 0: [0] } } },
]);
assert.equal(firstOption.correct, 1, "Option 0 counts as a correct answer");
assert.equal(firstOption.unanswered, 2);

const tasks = [
  testTask,
  { ...testTask, id: "unchecked-test", title: "Unsubmitted quiz" },
  textTask,
  { ...textTask, id: "activity-only", title: "Opened reading passage", options: testTask.options },
  { ...testTask, id: "homework", title: "Homework only", section: "homework" },
  { ...testTask, id: "teacher-only", title: "Teacher-only reference", options: { ...testTask.options, teacherOnly: true } },
  { ...testTask, id: "hidden", title: "Hidden task", hidden: true },
  { ...testTask, id: "done-later", title: "Recorded outside the lesson" },
  { ...textTask, id: "unworked", title: "Untouched passage" },
];
const checked = { checked: true, ans: { 0: [0], 1: [0] } };
const evidence = lessonTaskEvidence(tasks, [
  { taskId: testTask.id, lessonMs: 0, payload: checked },
  { taskId: "unchecked-test", lessonMs: 0, payload: { ans: { 0: [0] } } },
  { taskId: textTask.id, lessonMs: 0, payload: { worked: true } },
  { taskId: "activity-only", lessonMs: 120_000, payload: {} },
  { taskId: "homework", lessonMs: 120_000, payload: checked },
  { taskId: "teacher-only", lessonMs: 120_000, payload: checked },
  { taskId: "hidden", lessonMs: 120_000, payload: checked },
  { taskId: "done-later", lessonMs: 0, hwMs: 120_000, payload: checked },
  { taskId: "unworked", lessonMs: 50_000, payload: { worked: false } },
]);
assert.equal(evidence.length, 4);
const [partialTest, uncheckedTest, workedText, activityOnly] = evidence;
assert.equal(partialTest.correct, 1);
assert.equal(partialTest.incorrect, 1);
assert.equal(partialTest.unanswered, 1);
assert.equal(partialTest.recorded, 0);
assert.equal(uncheckedTest.recorded, 1);
assert.equal(uncheckedTest.correct + uncheckedTest.incorrect, 0);
assert.equal(workedText.teacherMarked, true);
assert.equal(workedText.topicName, "Synthetic custom topic");
assert.equal(hasRecordedWork(workedText), true);
assert.equal(hasRecordedWork(activityOnly), false);
assert.equal(activityOnly.activityMinutes, 2);
assert.deepEqual(lessonEvidenceTotals(evidence), { correct: 1, incorrect: 1, recorded: 1, unanswered: 3, worked: 3 });

// The complete outbound shape contains canonical codes and aggregate counts only.
assert.deepEqual(lessonModelEvidence(evidence), [{ code: topicId, tasks: 2, correct: 1, incorrect: 1, recorded: 1 }]);
assert.deepEqual(lessonModelEvidence([{ ...workedText, topicId: "synthetic-custom-code" }]), []);
assert.deepEqual(lessonModelEvidence([activityOnly]), []);
const request = lessonAnalysisInput(lessonModelEvidence(evidence));
assert.deepEqual(JSON.parse(request.messages[1].content), [{ code: topicId, tasks: 2, correct: 1, incorrect: 1, recorded: 1 }]);
assert.ok(request.messages.reduce((size, m) => size + Buffer.byteLength(m.content), 0) <= 950);
assert.deepEqual(parseLessonPractice(JSON.stringify([{ code: topicId, format: "drill", comment: "discard this" }]), request.included), [{ code: topicId, format: "drill" }]);
assert.equal(parseLessonPractice('[{"code":"unapproved","format":"drill"}]', request.included), null);
assert.equal(parseLessonPractice(JSON.stringify([{ code: topicId, format: "invented" }]), request.included), null);
assert.ok(LESSON_ANALYSIS_ESTIMATE_RUB * LESSON_ANALYSIS_MONTHLY_LIMIT <= 125);

const empty = lessonTaskEvidence(tasks, []);
assert.deepEqual(empty, []);
assert.deepEqual(lessonEvidenceTotals(empty), { correct: 0, incorrect: 0, recorded: 0, unanswered: 0, worked: 0 });
assert.equal(lessonEvidenceTotals([activityOnly]).worked, 0);
assert.deepEqual(lessonTaskEvidence([textTask], [{ taskId: textTask.id, lessonMs: 0, payload: { worked: false } }]), []);

console.log("Lesson analysis evidence checks passed");
