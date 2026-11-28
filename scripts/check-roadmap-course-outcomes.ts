import assert from "node:assert/strict";
import { courseOutcomesForRoute } from "../src/lib/roadmap/course-outcomes";
import { courseOutlineSchema, outlineUnitOutcomes } from "../src/lib/tasks/course-outline";

const previousBudget = JSON.stringify(Array<string>(6).fill("x".repeat(200))).length;
const inBudget = (outcomes: string[]) => {
  assert.ok(outcomes.length <= 6);
  assert.ok(JSON.stringify(outcomes).length <= previousBudget);
};

const legacy = Array.from({ length: 10 }, (_, index) => `Learn skill ${index + 1}`);
assert.deepEqual(courseOutcomesForRoute([]), []);
assert.deepEqual(courseOutcomesForRoute(legacy), legacy.slice(0, 6));
assert.deepEqual(courseOutcomesForRoute(["Topics — Travel", "Grammar — Past simple"]), ["Topics — Travel", "Grammar — Past simple"]);

const { units: [longUnit] } = courseOutlineSchema.parse({ units: [{
  title: "Long unit",
  grammar: "Past simple",
  vocabulary: "Calendar and schedules",
  skills: "Making appointments",
  lessons: Array.from({ length: 10 }, (_, index) => ({
    title: `Lesson ${index + 1}`,
    topics: `Topic${index + 1}-end ${"practice ".repeat(21).trim()}`,
  })),
}] });
const savedOutcomes = outlineUnitOutcomes(longUnit);
assert.ok(savedOutcomes.length > 6);
const sentOutcomes = courseOutcomesForRoute(savedOutcomes);
inBudget(sentOutcomes);
const sentTopics = sentOutcomes.find((entry) => entry.startsWith("Topics — "))!;
for (let index = 1; index <= longUnit.lessons.length; index++) {
  assert.ok(sentTopics.includes(`Topic${index}-end`), `Missing topic of lesson ${index}`);
}
assert.deepEqual(sentOutcomes.slice(1), [
  "Grammar — Past simple", "Vocabulary — Calendar and schedules", "Skills — Making appointments",
]);

const phrase = "Short clauses with verbs and modifiers ".repeat(6).trim();
const { units: [compactUnit] } = courseOutlineSchema.parse({ units: [{
  title: "Compact unit", topics: phrase, grammar: phrase, vocabulary: phrase, skills: phrase,
  lessons: [{ title: "Last lesson", topics: "Unique final topic" }],
}] });
const compactOutcomes = outlineUnitOutcomes(compactUnit);
assert.ok(compactOutcomes.length > 6);
assert.deepEqual(courseOutcomesForRoute(compactOutcomes), [
  `Topics — ${phrase} · Unique final topic`, `Grammar — ${phrase}`, `Vocabulary — ${phrase}`, `Skills — ${phrase}`,
]);

const dense = ["Topics", "Grammar", "Vocabulary", "Skills"].flatMap((category) =>
  Array.from({ length: 40 }, (_, index) => `${category} — ${index + 1} ${'слово "🙂" '.repeat(12)} · `));
const sampled = courseOutcomesForRoute(dense);
inBudget(sampled);
assert.equal(sampled.length, 4);
for (const category of sampled) {
  assert.match(category, / — 1 /);
  assert.match(category, / · 40 /);
  assert.match(category, / · …$/);
}
console.log("Roadmap leading course: earlier formats, late topics, and the six-by-200 input budget passed");
