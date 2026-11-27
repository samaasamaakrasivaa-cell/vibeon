import assert from "node:assert/strict";
import fs from "node:fs";
import fixSpecs from "../content/placement/09_fix.json";
import { buildFix, checkCore, type CoreItem } from "../src/lib/placement/engine";
import { fixFragment, fixWords, parseFixAnswer, replaceFixFragment, type FixSpan } from "../src/lib/placement/fix-answer";

const bank = ["A1", "A2", "B1", "B2", "C1"].flatMap((level, i) =>
  JSON.parse(fs.readFileSync(`content/placement/0${i + 1}_core_${level}.json`, "utf8")) as CoreItem[]);
const fixes = new Map(buildFix(bank, fixSpecs).map((item) => [item.id, item]));
assert.equal(fixes.size, fixSpecs.length);

function item(id: string) {
  const fix = fixes.get(`F-${id}`);
  assert.ok(fix?.span, id);
  return fix as CoreItem & { span: FixSpan };
}

const usedTo = item("G-B1-06");
const [use, to] = usedTo.span;
assert.equal(fixFragment(fixWords(usedTo.q), usedTo.span), "use to");
assert.equal(replaceFixFragment(fixWords(usedTo.q), [use, use], "used"), usedTo.q.replace("use to", "used to"));
assert.equal(replaceFixFragment(fixWords(usedTo.q), [use, use], "used to"), usedTo.q.replace("use to", "used to to"));
assert.equal(checkCore(usedTo, `${use}-${use}::used`), true);
assert.equal(checkCore(usedTo, `${use}-${to}::used to`), true);
assert.equal(checkCore(usedTo, `${use}-${use}::used to`), false);
assert.equal(checkCore(usedTo, `${use}-${to}::used to to`), false);
assert.equal(checkCore(usedTo, `${use}-${to}::used`), false);
assert.equal(checkCore(usedTo, `${use}-${to}::use to`), false);
assert.equal(checkCore(usedTo, `${use}-${to}::would`), false);
assert.equal(checkCore(usedTo, "0-0::used to"), false);
assert.equal(checkCore(usedTo, "0-999::used to"), false);
assert.equal(checkCore(usedTo, `${to}-${use}::used to`), false);
assert.equal(checkCore(usedTo, `${use}::used to`), true);
assert.equal(checkCore(usedTo, `${use}::used`), true);
assert.deepEqual(parseFixAnswer(`${use}::used to`), { span: [use, use], text: "used to", legacy: true });
assert.equal(parseFixAnswer("::used"), null);

function full(id: string, text: string, expected: boolean) {
  const fix = item(id);
  assert.equal(checkCore(fix, `${fix.span.join("-")}::${text}`), expected, `${id}: ${text}`);
}

full("G-B1-134", "would have booked", true);
full("G-B1-134", "could have booked", true);
full("G-B1-134", "'d have booked", true);
full("G-B1-134", "had have booked", false);
full("G-A1-29", "is sleeping", true);
full("G-A1-29", "'s sleeping", true);
full("G-A1-29", "has sleeping", false);
const continuous = item("G-A1-29");
const baby = continuous.span[0] - 1;
assert.equal(checkCore(continuous, `${baby}-${baby}::baby's`), true);
assert.equal(checkCore(continuous, `${baby}-${continuous.span[1]}::baby is sleeping`), true);
full("G-B1-138", "ought to have checked", true);
full("G-B1-138", "did not check", false);
full("G-B1-139", "probably went", false);
full("G-B1-142", "will still be flying", true);
full("G-B1-142", "will fly", false);
const legacyContinuous = { ...item("G-B1-142"), accept: ["will be flying", "will fly"] };
assert.equal(checkCore(legacyContinuous, `${legacyContinuous.span.join("-")}::will fly`), false);
full("G-B1-143", "am interviewing", false);
full("G-B1-150", "were planning to eat", false);
full("G-B1-151", "was going to cycle", true);
full("G-C1-16", "was taking", false);

function fixture(q: string, wrong: string, correct: string) {
  const source = { ...bank[0], q, type: "mcq" as const, options: [wrong, correct], answer: 1 };
  return buildFix([source], [{ from: source.id, wrong: 0, accept: [correct] }])[0];
}
assert.equal(checkCore(fixture("They ___ before noon.", "has arrived", "have arrived"), "1-1::have"), true);
assert.equal(checkCore(fixture("The report ___ yesterday.", "was send", "was sent"), "3-3::sent"), true);
assert.equal(checkCore(fixture("She ___ now.", "can swims", "can swim"), "1-2::can swim"), true);
assert.equal(checkCore(fixture("He said she ___, then left.", "was cook", "was cooking"), "4-4::cooking"), true);
assert.equal(checkCore(fixture("He said she ___, then left.", "was cook", "was cooking"), "4-4::cooking,"), true);

for (const fix of fixes.values()) {
  assert.ok(fix.accept?.length, fix.id);
  for (const accepted of fix.accept) {
    assert.equal(checkCore(fix, `${fix.span!.join("-")}::${accepted}`), true, fix.id);
  }
}
assert.equal(checkCore({ ...usedTo, type: "mcq", answer: 1 }, 1), true);
assert.equal(checkCore({ ...usedTo, type: "gap", accept: ["he is sleeping"] }, "he's sleeping"), true);
assert.equal(checkCore({ ...usedTo, type: "wordform", accept: ["written"] }, "WRITTEN!"), true);
assert.equal(checkCore({ ...usedTo, type: "transform", accept: ["had gone"] }, "'d gone"), true);
assert.equal(checkCore({ ...usedTo, type: "brackets", accept: ["doesn't go"] }, "does not go"), true);
console.log(`Placement Fix: ${fixes.size} заданий банка и регрессионные сценарии проверены.`);
