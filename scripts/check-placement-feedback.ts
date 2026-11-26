import assert from "node:assert/strict";
import { parseScore, applyScore, type ScoreInput } from "../src/lib/placement/ai-feedback";

const input: ScoreInput = { kind: "speaking", level: "B2", below: "B1", task: "", answers: ["", "I did went. I did went."],
  criteria: ["grammar","pronunciation"].map((id) => ({ id, name: id, level: "B2", below: "B1" })) };
const evidence = { grammar: [{ part: 2, quote: "I did went", comment: "После did нужна начальная форма." }] };
const edit = { part: 2, original: "did went", corrected: "went", occurrence: 2, criterion: "grammar", explanation: "В Past Simple достаточно went." };
const raw = { scores: { grammar: 2, pronunciation: 5 }, evidence, edits: [edit, edit, { ...edit, original: "heard this" }, { ...edit, occurrence: undefined }, { ...edit, criterion: "pronunciation" }] };
const score = parseScore(raw, input);
assert.equal(score.edits?.length, 1);
assert.equal(score.edits[0].start, input.answers[1].lastIndexOf("did went"));
assert.equal(score.unplaced, 4);
assert.equal(score.scores.pronunciation, null);
assert.equal(score.why.pronunciation, undefined);
assert.throws(() => parseScore({ ...raw, evidence: { grammar: [{ ...evidence.grammar[0], quote: "invented" }] } }, input));
const referenced = parseScore({ ...raw, evidence: { grammar: [{ source: "A2S2", quote: "inexact model wording", comment: "Форма глагола требует исправления." }] } }, input);
assert.match(referenced.why.grammar, /«I did went\.»/);
assert.ok(!referenced.why.grammar.includes("inexact"));
const manual = applyScore("speaking", "B2", score, { pronunciation: 4 }, { grammar: "Учитель уточнил", pronunciation: "По записи" });
assert.equal(manual.marks.pronunciation, 4);
assert.equal(manual.comments.grammar, "Учитель уточнил");
assert.equal(manual.comments.pronunciation, "По записи");
assert.match(applyScore("speaking", "B2", score).comments.grammar, /«I did went»/);
