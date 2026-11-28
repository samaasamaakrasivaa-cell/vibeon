import assert from "node:assert/strict";
import { emptyState, type CoreItem, type ListenItem, type PState, type ReadItem } from "../src/lib/placement/engine";
import { collectObjectiveFacts } from "../src/lib/placement/objective-facts";

const task = { level: "B1", band: 1, topic_en: "Fixture", topic_ru: "Пример", explain_ru: "" } as const;
const core = (id: string, skill: CoreItem["skill"], topicId: string): CoreItem => ({
  ...task, id, skill, topic_id: topicId, type: "gap", q: "Private fixture prompt", accept: ["key"],
});
const text = (id: string, kind: "reading" | "listening", total: number): ReadItem | ListenItem => {
  const base = {
    ...task, id, title: "Private fixture title",
    questions: Array.from({ length: total }, (_, n) => ({
      id: `${id}-${n + 1}`, q: "Private question", options: ["key", "other"],
      answer: 0, topic_id: "fixture-text", explain_ru: "",
    })),
  };
  return kind === "reading"
    ? { ...base, type: kind, skill: kind, passage: "Private reading" }
    : { ...base, type: kind, skill: kind, script: "Private transcript", audio: "/private-audio.ogg" };
};
const grammar = [core("g-1", "grammar", "g-topic"), core("g-2", "grammar", "g-topic")];
const vocab = core("v-1", "vocabulary", "v-topic");
const read = text("r-1", "reading", 5), listen = text("l-1", "listening", 4);
const extraGrammar = core("g-extra", "grammar", "g-topic");
const extraVocab = core("v-extra", "vocabulary", "v-topic");
const reads = [text("r-2", "reading", 3), text("r-3", "reading", 5)];
const extraListen = text("l-2", "listening", 4);
const graded = (item: ReadItem | ListenItem, correct: number): PState["answers"] =>
  Object.fromEntries(item.questions.map(({ id }, index) => [id, { v: index < correct ? 0 : 1, ok: index < correct }]));
const completed: PState = {
  ...emptyState(), section: "done", parts: ["core", "vocab", "reading", "listening"], step: 4, vstep: 5,
  sdates: { core: 100, vocab: 110, reading: 120, listening: 130 },
  items: Object.fromEntries([...grammar, vocab, read, listen].map((item) => [item.id, item])),
  core: [{ id: "g-1", ph: "d", step: 4 }, { id: "g-2", ph: "r", step: 4 }, { id: "v-1", ph: "vm", step: 4 }],
  reading: [read.id], rdone: [read.id], listening: [listen.id], ldone: [listen.id],
  answers: { "g-1": { v: "private-answer", ok: true }, "g-2": { v: null, ok: false, dk: true },
    "v-1": { v: "private-corrected-answer", ok: true }, ...graded(read, 4), ...graded(listen, 2) },
};
type Result = ReturnType<typeof collectObjectiveFacts>;
const results = (value: Result, skill: Result["facts"][number]["skill"]) =>
  value.facts.flatMap((entry) => {
    if (entry.skill !== skill || entry.status !== "checked") return [];
    const { factId, ...fact } = entry;
    return [[fact, value.evidence[factId]] as const];
  });
const reasons = (value: Result, skill: Result["facts"][number]["skill"]) =>
  value.facts.flatMap((fact) => fact.skill === skill && fact.status === "unknown" ? [fact.reason] : []);

const original = collectObjectiveFacts(structuredClone(completed));
const [grammarBlock, grammarTopic] = results(original, "grammar");
assert.deepEqual(grammarBlock[0], { skill: "grammar", status: "checked", scope: "initial", correct: 1, total: 2, level: "B1", taskLevels: ["B1"] });
assert.equal(grammarTopic[0].topicId, "g-topic");
assert.deepEqual(grammarTopic[1].items.flatMap(({ questionIds }) => questionIds), ["g-1", "g-2"]);
assert.equal(results(original, "vocabulary")[0][0].level, "B1+");
assert.equal(results(original, "reading")[0][0].level, "B1+");
assert.equal(results(original, "listening")[0][0].level, "B1");
assert.doesNotMatch(JSON.stringify(original), /Private|private-|accept|\.ogg/);
assert.deepEqual(collectObjectiveFacts(JSON.parse(JSON.stringify(completed))), original);
const sameGradeNewAnswer = { ...completed, answers: { ...completed.answers, "g-1": { v: "changed", ok: true } } };
assert.notEqual(collectObjectiveFacts(sameGradeNewAnswer).revision, original.revision);
assert.deepEqual(collectObjectiveFacts({ ...completed, writing: { id: "ignored", text: "Irrelevant to these four facts." } }), original);

const repeated: PState = {
  ...completed,
  items: { ...completed.items, ...Object.fromEntries([extraGrammar, extraVocab, ...reads, extraListen].map((item) => [item.id, item])) },
  core: [...completed.core, { id: extraGrammar.id, step: 4, ph: "z" }, { id: extraVocab.id, step: 4, ph: "vz" }],
  reading: [read.id, ...reads.map(({ id }) => id)], rdone: [read.id, ...reads.map(({ id }) => id)],
  listening: [listen.id, extraListen.id], ldone: [listen.id, extraListen.id],
  sdates: { core: 220, vocab: 240, reading: 320, listening: 340 },
  xs: [{ kind: "core", level: "B1", at: 210 }, { kind: "vocab", level: "B1", at: 230 },
    { kind: "reading", level: "B1", at: 250 }, { kind: "reading", level: "B1", at: 310 }, { kind: "listening", level: "B1", at: 330 }],
  answers: { ...completed.answers, "g-extra": { v: "retry", ok: true }, "v-extra": { v: "wrong", ok: false },
    ...graded(reads[0], 1), ...graded(reads[1], 3), ...graded(extraListen, 4) },
};
const repeats = collectObjectiveFacts(repeated);
for (const skill of ["grammar", "vocabulary"] as const) {
  assert.deepEqual(results(repeats, skill).filter(([fact]) => fact.scope === "initial"), results(original, skill));
  const [extra, source] = results(repeats, skill).find(([fact]) => fact.scope === "additional")!;
  assert.equal(extra.total, 1);
  assert.equal(extra.level, undefined);
  assert.equal(source.items[0].itemId, skill === "grammar" ? extraGrammar.id : extraVocab.id);
}
assert.deepEqual(results(repeats, "reading").map(([fact, source]) => [fact.scope, fact.correct, fact.total, source.assignedAt]),
  [["initial", 4, 5, undefined], ["additional", 1, 3, 250], ["additional", 3, 5, 310]]);
assert.deepEqual(results(repeats, "listening").map(([fact, source]) => [fact.scope, fact.correct, fact.total, source.assignedAt]),
  [["initial", 2, 4, undefined], ["additional", 4, 4, 330]]);
const pendingRead = collectObjectiveFacts({ ...repeated, section: "reading", rdone: repeated.rdone.slice(0, -1),
  xt: { kind: "reading", level: "B1" }, open: { "r-3-1": 0 } });
assert.deepEqual(results(pendingRead, "reading"), results(repeats, "reading").slice(0, -1));
assert.deepEqual(reasons(pendingRead, "reading"), ["not-confirmed"]);
const pendingCore = collectObjectiveFacts({ ...repeated, section: "core", xq: { kind: "core", level: "B1", ids: ["g-extra"] } });
assert.deepEqual(results(pendingCore, "grammar"), results(original, "grammar"));
assert.deepEqual(reasons(pendingCore, "grammar"), ["not-confirmed"]);

const afterAddition = collectObjectiveFacts({ ...completed, added: 115 });
assert.deepEqual(reasons(afterAddition, "grammar"), ["unknown-origin"]);
assert.deepEqual(reasons(afterAddition, "vocabulary"), ["unknown-origin"]);
assert.equal(results(afterAddition, "reading")[0][0].scope, "additional");
assert.equal(results(afterAddition, "listening")[0][0].scope, "additional");
const mixed = collectObjectiveFacts({ ...repeated, added: 150 });
assert.deepEqual(reasons(mixed, "reading"), ["unknown-origin"]);
assert.equal(results(mixed, "reading").length, 2);
assert.deepEqual(reasons(mixed, "grammar"), ["unknown-origin"]);
assert.equal(results(mixed, "grammar").length, 1);

const missing = collectObjectiveFacts({ ...emptyState(), section: "done", parts: ["reading"], step: 4, base: 4, baseFrom: "teacher" });
assert.equal(missing.facts.length, 4);
assert.ok(missing.facts.every((fact) => fact.status === "unknown" && fact.reason === "not-tested"));
const unfinished = collectObjectiveFacts({ ...completed, section: "core", sdates: {}, rdone: [], ldone: [], open: { "l-1-1": 0 } });
for (const skill of ["grammar", "vocabulary", "reading", "listening"] as const) assert.deepEqual(reasons(unfinished, skill), ["not-confirmed"]);
const broken = collectObjectiveFacts({ ...repeated, xs: repeated.xs!.map((entry) => entry.kind === "listening" ? { ...entry, level: "C1" } : entry) });
assert.deepEqual(reasons(broken, "listening"), ["unknown-origin"]);
assert.equal(results(broken, "listening").length, 0);
const datedBeforeAssignment = collectObjectiveFacts({ ...repeated, sdates: { ...repeated.sdates, listening: 329 } });
assert.deepEqual(reasons(datedBeforeAssignment, "listening"), ["unknown-origin"]);
const extraOnly = collectObjectiveFacts({ ...repeated, parts: ["vocab"], reading: [reads[0].id], rdone: [reads[0].id],
  xs: [{ kind: "reading", level: "B1", at: 250 }] });
assert.deepEqual(results(extraOnly, "reading").map(([fact]) => fact.scope), ["additional"]);
const answersWithHole = { ...completed.answers };
delete answersWithHole["r-1-1"];
const missingAnswer = collectObjectiveFacts({ ...completed, answers: answersWithHole });
assert.deepEqual(reasons(missingAnswer, "reading"), ["unknown-origin"]);
assert.equal(results(missingAnswer, "reading").length, 0);
const legacy = collectObjectiveFacts({ ...completed, sdates: undefined });
assert.deepEqual(legacy, original);

console.log("PASS objective Placement facts: complete and incomplete sections, separate retakes, gaps, saved scores, revisions and evidence");
