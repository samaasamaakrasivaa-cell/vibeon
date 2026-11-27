import assert from "node:assert/strict";
import { defaultOn } from "../src/lib/placement/report";
import type { ReportDataT } from "../src/lib/placement/report-data";
import { lastPublication, makePublication, publicationScripts, publicationStamp, reportDraft, reportSource, storedReport } from "../src/lib/placement/report-publication";

const cfg = { lang: "en" as const, on: defaultOn("student"), texts: { "en:plan": "First teacher plan." } };
const listening = {
  id: "fixture-listening", kind: "listening", level: "B1", title: "Museum", passage: null,
  audio: "/fixture-audio.mp3", script: "Private script text.", situation: "Internal context", plays: 2,
  questions: [{ id: "fixture-question", q: "When does it close?", options: ["Five", "Six"], answer: 0, given: 1, ok: false, dk: false, tried: ["Private trail"] }],
};
const data = {
  input: { name: "Fixture Student", teen: false, level: "B1", skills: {}, families: [], vweak: [], comment: "" },
  d: { core: [], reading: [], listening: [listening], speaking: { questions: [{ url: "Private recording" }] }, times: { core: 1000 } },
  writing: null, speaking: null, max: 3, saved: {}, finalLevel: "B1", date: "2026-01-05T23:30:00.000Z",
} as unknown as ReportDataT;

const at = "2026-01-10T12:00:00.000Z", zone = "Europe/Moscow";
const first = makePublication(data, cfg, "fixture-v1", at, zone);
assert.equal(first.schema, 1);
assert.equal(first.sentAt, at);
assert.equal(first.timeZone, zone);
assert.equal(first.sheet.date, data.date);
assert.equal(first.texts.plan, "First teacher plan.");
assert.equal(first.answers.listening[0].questions[0].answer, 0);
assert.equal(first.answers.listening[0].questions[0].ok, false);
assert.doesNotMatch(JSON.stringify(first), /Private script|Private recording|Private trail|Internal context/);
assert.deepEqual(publicationScripts(first, { "fixture-listening": "Private script text.", extra: "Extra script" }), { "fixture-listening": "Private script text." });
assert.deepEqual(publicationScripts(first, { "fixture-listening": "Changed script" }), {});

const old = storedReport({ report: { student: cfg, sent: true, sentAt: at } });
const edited = { ...cfg, texts: { "en:plan": "New private draft." } };
assert.equal(lastPublication(old), undefined);
assert.equal(publicationStamp(old).version, at);
assert.equal(reportDraft({ ...old, draft: { student: edited } }).student?.texts["en:plan"], "New private draft.");
assert.equal(old.student?.texts["en:plan"], "First teacher plan.");

const second = makePublication(data, edited, "fixture-v2", "2026-01-11T12:00:00.000Z", zone);
const hidden = { ...old, sent: false, publications: [first, second] };
assert.equal(lastPublication(hidden)?.texts.plan, "New private draft.");
assert.equal(hidden.publications[0].texts.plan, "First teacher plan.");
assert.deepEqual(publicationStamp(hidden), { sent: false, version: "fixture-v2" });
assert.equal(reportDraft(hidden).sent, false);
assert.equal("publications" in reportDraft(hidden), false);
assert.notEqual(reportSource(data, zone), reportSource(data, "UTC"));
const editedSource = { ...data, d: { ...data.d, listening: [{ ...data.d.listening[0], script: "Changed script" }] } };
assert.notEqual(reportSource(data, zone), reportSource(editedSource, zone));
console.log("PASS placement immutable report projection, legacy drafts, revocable scripts and storage metadata");
