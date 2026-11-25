// npx tsx scripts/check-placement-regrading.ts
import assert from "node:assert/strict";
import { missingReassessment, teacherReview } from "../src/lib/placement/teacher-review";
import { rubricOf } from "../src/lib/placement/rubric";

const previous = {
  writing: { task: 3, coherence: 3, vocabulary: 2, grammar: 3 },
  speaking: { fluency: 2, vocabulary: 2, grammar: 3, pronunciation: 1 },
  report: { sent: true }, comment: "Saved feedback",
};
const attempt = { review: previous, reviewedAt: new Date("2026-01-01"), level: "B2" };
const editor = teacherReview(attempt);
assert.equal(editor.regrading, true);
assert.equal(rubricOf(editor.active).max, 5);
assert.equal(editor.active.writing, undefined);
assert.equal(editor.active.speaking, undefined);
assert.deepEqual(editor.active.legacyReview?.speaking, previous.speaking);

const writing = { content: 4, organisation: 4, language: 5, achievement: 3 };
const saved = editor.edit({ writing, wc: { content: "Draft feedback" } });
assert.equal(rubricOf(saved).max, 3);
assert.deepEqual(saved.writing, previous.writing);
assert.deepEqual(saved.report, previous.report);
const resumed = teacherReview({ ...attempt, review: saved });
assert.deepEqual(resumed.active.writing, writing);
assert.equal(missingReassessment(resumed.stored, resumed.active), "speaking");
const speaking = { grammar: 4, vocabulary: 4, pronunciation: 4, discourse: 5 };
const completed = teacherReview({ ...attempt, review: resumed.edit({ speaking }) });
assert.equal(missingReassessment(completed.stored, completed.active), null);
assert.equal(teacherReview({ ...attempt, review: completed.active }).regrading, false);

// Прежнее говорение могло сохранить лишь один общий для обеих шкал критерий.
assert.equal(teacherReview({ ...attempt, review: { speaking: { grammar: 2 } } }).regrading, true);
assert.equal(teacherReview({ ...attempt, review: { rubric: 2, speaking: { grammar: 2 } } }).regrading, false);
assert.equal(teacherReview({ ...attempt, review: {} }).regrading, false);
