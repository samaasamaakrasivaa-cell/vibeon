import assert from "node:assert/strict";
import test from "node:test";
import { countsAsAutoCheckedHomework, currentHomeworkAnswers, isAssignedHomeworkTask, needsHomeworkReview } from "../src/lib/homework-review";
import { assignedHomeworkTasks, setHomeworkAssignment } from "../src/lib/tasks/homework-selection";

const essay = { id: "essay", type: "essay", content: "Explain your choice.", options: {}, section: "homework", hidden: false };
const essayAnswer = { text: "I chose the longer route." };
const assigned = { manual: true, extraTaskIds: [essay.id] };
const pending = "NEEDS_REVIEW";

test("a fresh homework only contains exercises assigned from the lesson or prepared section", () => {
  const inClass = { ...essay, id: "lesson-exercise", section: "lesson" };
  const tasks = [inClass, essay];
  const fresh = { manual: true, taskIds: [], extraTaskIds: [], removedTaskIds: [] };
  assert.deepEqual(assignedHomeworkTasks(tasks, fresh), []);
  const picked = setHomeworkAssignment(fresh, [essay, inClass], true);
  assert.deepEqual(assignedHomeworkTasks(tasks, { ...fresh, ...picked }), [essay, inClass]);
  assert.deepEqual(setHomeworkAssignment({ ...fresh, ...picked }, [essay, inClass], true), picked);
  assert.deepEqual(assignedHomeworkTasks(tasks, { ...fresh, ...setHomeworkAssignment({ ...fresh, ...picked }, [essay], false) }), [inClass]);
});

test("legacy prepared homework can be removed and reassigned without showing duplicates", () => {
  const legacy = { manual: false, taskIds: [essay.id], extraTaskIds: [essay.id], removedTaskIds: [] };
  assert.deepEqual(assignedHomeworkTasks([essay], legacy), [essay]);
  const removed = { ...legacy, ...setHomeworkAssignment(legacy, [essay], false) };
  assert.deepEqual(assignedHomeworkTasks([essay], removed), []);
  assert.equal(isAssignedHomeworkTask(essay, removed), false);
  const assignedAgain = { ...legacy, ...setHomeworkAssignment(removed, [essay], true) };
  assert.deepEqual(assignedHomeworkTasks([essay], assignedAgain), [essay]);
  assert.equal(isAssignedHomeworkTask(essay, assignedAgain), true);
});

test("the review signal requires a complete actionable answer without a teacher decision", () => {
  assert.equal(needsHomeworkReview(essay, assigned, essayAnswer, pending, false), true);
  assert.equal(needsHomeworkReview(essay, assigned, { text: " " }, pending, false), false);
  assert.equal(needsHomeworkReview(essay, assigned, essayAnswer, "DRAFT", false), false);
  assert.equal(needsHomeworkReview(essay, assigned, essayAnswer, "REVIEWED", false), false);
  for (const decision of [{ ok: true }, { ok: false }]) {
    assert.equal(needsHomeworkReview(essay, assigned, essayAnswer, pending, !!decision), false);
  }
  const autoTask = { ...essay, type: "gap", content: "I [am] ready." };
  assert.equal(needsHomeworkReview(autoTask, assigned, { val: { "0:1": "am" }, checked: true }, pending, false), false);
});

test("translation and transformation follow the persisted manual status while legacy auto checks stay complete", () => {
  for (const type of ["translate", "transform"]) {
    const task = { ...essay, type, content: "The longer route → the short route" };
    const answer = { val: { 0: "the short route" }, checked: true };
    assert.equal(needsHomeworkReview(task, assigned, answer, pending, false), true);
    assert.equal(needsHomeworkReview(task, assigned, answer, "AUTO_CHECKED", false), false);
    assert.equal(countsAsAutoCheckedHomework(type, "AUTO_CHECKED", false), true);
    assert.equal(countsAsAutoCheckedHomework(type, "AUTO_CHECKED", true), false);
    assert.equal(countsAsAutoCheckedHomework(type, "REVIEWED", true), false);
    assert.equal(countsAsAutoCheckedHomework(type, pending, false), false);
  }
});

test("review observes manual and legacy homework assignment visibility", () => {
  assert.equal(isAssignedHomeworkTask(essay, { manual: true, extraTaskIds: [] }), false);
  assert.equal(isAssignedHomeworkTask(essay, { manual: false, extraTaskIds: [] }), true);
  assert.equal(isAssignedHomeworkTask(essay, { ...assigned, removedTaskIds: [essay.id] }), false);
  assert.equal(isAssignedHomeworkTask({ ...essay, options: { teacherOnly: true } }, assigned), false);
  const hidden = { ...essay, hidden: true, section: "lesson" };
  assert.equal(isAssignedHomeworkTask(hidden, assigned), false);
  assert.equal(isAssignedHomeworkTask(hidden, { ...assigned, manual: false }), true);
});

test("a group member's review uses only that member's answer for this lesson", () => {
  const current = { lessonInstanceId: "current", studentId: "student-a", status: "AUTO_CHECKED" };
  const rows = [
    current,
    { lessonInstanceId: "previous", studentId: "student-a", status: pending },
    { lessonInstanceId: "current", studentId: "student-b", status: pending },
    { lessonInstanceId: "current-b", studentId: "student-b", status: pending },
  ];
  const [own] = currentHomeworkAnswers(rows, current.lessonInstanceId, current.studentId);
  assert.deepEqual(currentHomeworkAnswers(rows, current.lessonInstanceId, current.studentId), [current]);
  assert.equal(needsHomeworkReview(essay, assigned, essayAnswer, own.status, false), false);
  const [other] = currentHomeworkAnswers(rows, "current-b", "student-b");
  assert.equal(needsHomeworkReview(essay, assigned, essayAnswer, other.status, false), true);
  const otherAssignment = { manual: true, extraTaskIds: [] };
  assert.equal(needsHomeworkReview(essay, otherAssignment, essayAnswer, other.status, false), false);
  assert.equal(needsHomeworkReview(essay, undefined, essayAnswer, other.status, false), false);
});
