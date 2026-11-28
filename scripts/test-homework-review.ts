import assert from "node:assert/strict";
import test from "node:test";
import {
  countsAsAutoCheckedHomework,
  currentHomeworkAnswers,
  isAssignedHomeworkTask,
  needsHomeworkReview,
  planHomeworkResubmission,
  submitHomeworkResubmission,
} from "../src/lib/homework-review";
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

const ownHomework = { lessonInstanceId: "lesson-a", studentId: "student-a" };
const archiveId = "archived-attempt-a";

function returnedEssay() {
  return {
    id: "answer-a",
    ...ownHomework,
    taskId: essay.id,
    revision: 7,
    status: "REVIEWED",
    payload: {
      ...essayAnswer,
      rounds: Array.from({ length: 10 }, (_, i) => ({ p: { text: `Earlier answer ${i}` } })),
    },
    teacherReview: { ok: false, comment: "Explain the trade-off", at: "2026-11-27", ai: { corrected: "The longer route is quieter." } },
    shownToStudent: true,
    attempts: 3,
    updatedAt: new Date("2026-11-27T12:00:00Z"),
  };
}

test("a returned assigned task opens an empty draft and archives the complete reviewed attempt separately", () => {
  const original = returnedEssay();
  const transition = planHomeworkResubmission(ownHomework, essay, assigned, original, archiveId);
  assert.ok(transition);
  assert.equal(transition.expectedRevision, original.revision);
  assert.deepEqual(transition.archivedAttempt, { id: archiveId, snapshot: original });
  assert.notEqual(transition.archivedAttempt.snapshot.payload, original.payload);
  assert.notEqual(transition.archivedAttempt.snapshot.teacherReview, original.teacherReview);
  assert.deepEqual(transition.draft, {
    ...ownHomework,
    taskId: essay.id,
    previousAttemptId: archiveId,
    revision: 8,
    payload: {},
    status: "DRAFT",
    teacherReview: null,
    shownToStudent: false,
  });
  assert.equal(transition.archivedAttempt.snapshot.payload.rounds.length, 10);
});

test("retry excludes approved or malformed reviews, non-reviewed attempts and unavailable homework", () => {
  const original = returnedEssay();
  for (const teacherReview of [{ ok: true }, { ok: "false" }, null, { comment: "Old feedback" }]) {
    assert.equal(planHomeworkResubmission(ownHomework, essay, assigned, { ...original, teacherReview }, archiveId), null);
  }
  for (const status of ["DRAFT", "AUTO_CHECKED", "NEEDS_REVIEW"]) {
    assert.equal(planHomeworkResubmission(ownHomework, essay, assigned, { ...original, status }, archiveId), null);
  }
  assert.equal(planHomeworkResubmission(ownHomework, essay, assigned, original, ""), null);
  assert.equal(planHomeworkResubmission(ownHomework, essay, { manual: true, extraTaskIds: [] }, original, archiveId), null);
  assert.equal(planHomeworkResubmission(ownHomework, essay, { ...assigned, removedTaskIds: [essay.id] }, original, archiveId), null);
  assert.equal(planHomeworkResubmission(ownHomework, { ...essay, hidden: true }, assigned, original, archiveId), null);
  assert.equal(planHomeworkResubmission(ownHomework, { ...essay, options: { teacherOnly: true } }, assigned, original, archiveId), null);
  assert.ok(planHomeworkResubmission(ownHomework, essay, { manual: false, extraTaskIds: [] }, original, archiveId));
});

test("a partial draft stays outside the queue and only a complete new submission re-enters it", () => {
  const transition = planHomeworkResubmission(ownHomework, essay, assigned, returnedEssay(), archiveId);
  assert.ok(transition);
  const partial = { ...transition.draft, payload: { text: " " } };
  assert.equal(submitHomeworkResubmission(ownHomework, essay, assigned, { ...transition, draft: partial }), null);
  const completed = { ...transition.draft, payload: { text: "The route has less traffic and more shade." } };
  assert.equal(needsHomeworkReview(essay, assigned, completed.payload, completed.status, false), false);
  assert.equal(submitHomeworkResubmission(ownHomework, essay, assigned, { archivedAttempt: null, draft: completed }), null);
  const submission = submitHomeworkResubmission(ownHomework, essay, assigned, { ...transition, draft: completed });
  assert.ok(submission);
  assert.equal(needsHomeworkReview(essay, assigned, completed.payload, submission.status, false), true);
  assert.equal(submitHomeworkResubmission(ownHomework, essay, assigned, { ...transition, draft: { ...completed, status: submission.status } }), null);
  assert.equal(submitHomeworkResubmission(ownHomework, essay, { ...assigned, removedTaskIds: [essay.id] }, { ...transition, draft: completed }), null);
  assert.equal(transition.archivedAttempt.snapshot.teacherReview.comment, "Explain the trade-off");
  assert.equal(transition.archivedAttempt.snapshot.payload.text, essayAnswer.text);
});

test("a translation or transformation draft with an unanswered row stays out of the review queue", () => {
  for (const type of ["translate", "transform"]) {
    const task = { ...essay, type, content: "First sentence → First answer\nSecond sentence" };
    const transition = planHomeworkResubmission(ownHomework, task, assigned, returnedEssay(), archiveId);
    assert.ok(transition);
    assert.equal(transition.draft.status, "DRAFT");

    const partialAnswers = [{ 0: "First answer" }, { 0: "First answer", 1: " \t" }];
    for (const val of partialAnswers) {
      assert.equal(submitHomeworkResubmission(ownHomework, task, assigned, {
        archivedAttempt: transition.archivedAttempt,
        draft: { ...transition.draft, payload: { val } },
      }), null, type);
    }
  }
});

test("a complete translation or transformation without answer keys can be submitted for review", () => {
  for (const type of ["translate", "transform"]) {
    const task = { ...essay, type, content: "First sentence\n\nSecond sentence" };
    const transition = planHomeworkResubmission(ownHomework, task, assigned, returnedEssay(), archiveId);
    assert.ok(transition);

    const draft = { ...transition.draft, payload: { val: { 0: "First answer", 1: "Second answer" } } };
    assert.deepEqual(submitHomeworkResubmission(ownHomework, task, assigned, { ...transition, draft }), {
      status: pending,
      expectedRevision: draft.revision,
    }, type);
  }
});

test("a neighbouring task, lesson, or group member cannot reuse the returned decision or draft", () => {
  const original = returnedEssay();
  const transition = planHomeworkResubmission(ownHomework, essay, assigned, original, archiveId);
  assert.ok(transition);
  const complete = { ...transition.draft, payload: { text: "My updated answer" } };
  for (const scope of [
    { ...ownHomework, studentId: "student-b" },
    { ...ownHomework, lessonInstanceId: "other-lesson" },
  ]) {
    assert.equal(planHomeworkResubmission(scope, essay, assigned, original, archiveId), null);
    assert.equal(submitHomeworkResubmission(scope, essay, assigned, { ...transition, draft: complete }), null);
  }
  assert.equal(submitHomeworkResubmission(ownHomework, essay, assigned, {
    archivedAttempt: { id: archiveId, snapshot: { ...original, studentId: "student-b" } },
    draft: complete,
  }), null);
  const neighbour = { ...essay, id: "neighbour" };
  const bothAssigned = { ...assigned, extraTaskIds: [essay.id, neighbour.id] };
  assert.equal(planHomeworkResubmission(ownHomework, neighbour, bothAssigned, original, archiveId), null);
  assert.equal(submitHomeworkResubmission(ownHomework, neighbour, bothAssigned, { ...transition, draft: complete }), null);
});

test("a second draft rejects an older archive for the same answer, task, lesson, and student", () => {
  const first = returnedEssay();
  const firstTransition = planHomeworkResubmission(ownHomework, essay, assigned, first, archiveId);
  assert.ok(firstTransition);
  const second = {
    ...first,
    revision: 10,
    payload: { ...first.payload, text: "I chose it because there is less traffic." },
    teacherReview: { ...first.teacherReview, comment: "Also explain the extra time." },
  };
  const secondTransition = planHomeworkResubmission(ownHomework, essay, assigned, second, "archived-attempt-b");
  assert.ok(secondTransition);

  const draft = { ...secondTransition.draft, payload: { text: "The extra time is worth it because the route is quieter." } };
  assert.equal(submitHomeworkResubmission(ownHomework, essay, assigned, { archivedAttempt: firstTransition.archivedAttempt, draft }), null);
  assert.equal(submitHomeworkResubmission(ownHomework, essay, assigned, {
    archivedAttempt: secondTransition.archivedAttempt,
    draft: { ...draft, previousAttemptId: "" },
  }), null);
  assert.deepEqual(submitHomeworkResubmission(ownHomework, essay, assigned, {
    archivedAttempt: secondTransition.archivedAttempt, draft,
  }), { status: pending, expectedRevision: draft.revision });
  assert.deepEqual(firstTransition.archivedAttempt.snapshot, first);
  assert.deepEqual(secondTransition.archivedAttempt.snapshot, second);
});

test("a revision-checked adapter admits one concurrent draft and one concurrent submission", async () => {
  const returned = returnedEssay();
  const stored: { revision: number; transition: ReturnType<typeof planHomeworkResubmission<typeof returned>> } = {
    revision: returned.revision,
    transition: null,
  };
  const openDraft = async (id: string) => {
    const transition = planHomeworkResubmission(ownHomework, essay, assigned, returned, id);
    assert.ok(transition);
    await Promise.resolve();
    if (stored.revision !== transition.expectedRevision) return false;
    stored.transition = transition;
    stored.revision = transition.draft.revision;
    return true;
  };

  assert.deepEqual(await Promise.all([openDraft(archiveId), openDraft("competing-archive")]), [true, false]);
  const current = stored.transition;
  assert.ok(current);
  assert.equal(current.archivedAttempt.id, current.draft.previousAttemptId);
  assert.deepEqual(current.archivedAttempt.snapshot, returned);
  const draft = { ...current.draft, payload: { text: "This route has less traffic and more shade." } };
  let status: string = draft.status;
  const submitDraft = async () => {
    const submission = submitHomeworkResubmission(ownHomework, essay, assigned, { archivedAttempt: current.archivedAttempt, draft });
    assert.ok(submission);
    await Promise.resolve();
    if (stored.revision !== submission.expectedRevision) return false;
    status = submission.status;
    stored.revision++;
    return true;
  };

  assert.deepEqual(await Promise.all([submitDraft(), submitDraft()]), [true, false]);
  assert.equal(stored.revision, draft.revision + 1);
  assert.equal(status, pending);
  assert.deepEqual(current.archivedAttempt.snapshot, returned);
});
