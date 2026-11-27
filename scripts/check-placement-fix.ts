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
assert.equal(checkCore(usedTo, `${use}::used to to`), false);
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
full("G-A1-09", "There's", true);
full("G-A1-52", "'d", false); // had — смысловой глагол.
full("G-A2-07", "'s going to", true);
full("G-B1-55", "’d left", true);
full("G-B1-55", "would left", false);
full("G-B1-118", "'s approved", true);
full("G-B1-118", "is approved", false);
full("G-B2-17", "'s said to serve", true); // Сокращение после café.
full("G-B1-154", "'d be bringing", true);
full("G-C1-53", "'d", true);
full("G-C1-57", "'d", false); // Инверсия Had I ... .
const oldPastPerfect = { ...item("G-B1-55"), accept: ["had left"] };
assert.equal(checkCore(oldPastPerfect, `${oldPastPerfect.span[0]}::'d left`), true);
assert.equal(checkCore(oldPastPerfect, `${oldPastPerfect.span.join("-")}::'d left`), true);
const continuous = item("G-A1-29");
const baby = continuous.span[0] - 1;
assert.equal(checkCore(continuous, `${baby}-${baby}::baby's`), true);
assert.equal(checkCore(continuous, `${baby}-${continuous.span[1]}::baby is sleeping`), true);
full("G-B1-138", "ought to have checked", true);
full("G-B1-138", "did not check", false);
full("G-B1-139", "probably went", false);
full("G-B1-142", "will still be flying", true);
full("G-B1-142", "will fly", false);
full("G-B1-142", "will flying", false);
full("G-B1-143", "am interviewing", false);
full("G-B1-150", "were planning to eat", false);
full("G-B1-150", "were go to eat", false);
full("G-B1-151", "was going to cycle", true);
full("G-C1-16", "was taking", false);
const singularSnapshot = { ...item("G-C1-16"), q: "She took a break when I called.", span: [1, 1] as FixSpan };
assert.equal(checkCore({ ...singularSnapshot, accept: ["was taking"] }, "1-1::was taking"), true);

function fixture(q: string, wrong: string, correct: string) {
  const source = { ...bank[0], q, type: "mcq" as const, options: [wrong, correct], answer: 1 };
  return buildFix([source], [{ from: source.id, wrong: 0, accept: [correct] }])[0];
}
assert.equal(checkCore(fixture("They ___ before noon.", "has arrived", "have arrived"), "1-1::have"), true);
assert.equal(checkCore(fixture("The report ___ yesterday.", "was send", "was sent"), "3-3::sent"), true);
assert.equal(checkCore(fixture("She ___ now.", "can swims", "can swim"), "1-2::can swim"), true);
assert.equal(checkCore(fixture("He said she ___, then left.", "was cook", "was cooking"), "4-4::cooking"), true);
assert.equal(checkCore(fixture("He said she ___, then left.", "was cook", "was cooking"), "4-4::cooking,"), true);

let bankAlternatives = 0;
for (const { from, accept } of fixSpecs) {
  const fix = item(from);
  assert.ok(fix.accept?.length, fix.id);
  assert.notEqual(fix.wrong, undefined, fix.id);
  assert.equal(checkCore(fix, `${fix.span.join("-")}::${fix.wrong}`), false, fix.id);
  for (const accepted of fix.accept) {
    assert.equal(checkCore(fix, `${fix.span.join("-")}::${accepted}`), true, fix.id);
  }
  for (const declared of accept) {
    bankAlternatives++;
    assert.ok(fix.accept.includes(declared), `${from}: ${declared}`);
    assert.equal(checkCore(fix, `${fix.span.join("-")}::${declared}`), true, `${from}: ${declared}`);
    assert.equal(checkCore(fix, `${fix.span[0]}::${declared}`), true, `${from}: ${declared}`);
  }
}
// Новые вопросы ограничивают ключ. Старый снимок сохраняет свои варианты.
const retiredAlternatives = [
  ["G-B1-138", "didn't check", "did not check"],
  ["G-B1-139", "went", "probably went"],
  ["G-B1-142", "are flying", "will fly"],
  ["G-B1-143", "am interviewing"],
  ["G-B1-150", "were planning to eat", "had planned to eat", "wanted to eat", "meant to eat"],
  ["G-B1-151", "was planning to cycle", "had planned to cycle", "meant to cycle", "wanted to cycle"],
  ["G-C1-16", "was taking"],
] as const;
for (const [id, ...retired] of retiredAlternatives) {
  const fix = item(id);
  const spec = fixSpecs.find((f) => f.from === id);
  assert.ok(spec?.instruction_en, id);
  const legacy = { ...fix, instruction_en: undefined, accept: [...fix.accept!, ...retired] };
  for (const correction of retired) {
    assert.ok(!spec.accept.includes(correction), `${id}: ${correction}`);
    full(id, correction, false);
    // PT-01 rejects only the subject–verb disagreement already present in this context.
    const acceptedInSnapshot = id !== "G-C1-16";
    assert.equal(checkCore(legacy, `${legacy.span.join("-")}::${correction}`), acceptedInSnapshot, `${id}: ${correction}`);
    assert.equal(checkCore(legacy, `${legacy.span[0]}::${correction}`), acceptedInSnapshot, `${id}: ${correction}`);
  }
  if (id === "G-B1-142") assert.equal(checkCore(legacy, `${legacy.span[0]}::will flying`), false);
}
full("G-A2-110", "that", true);
full("G-B1-72", "whether", true);
full("G-B1-142", "will be still flying", true);
full("G-B2-66", "have", true);
full("G-C1-64", "should get", true);
full("G-C1-23", "was to become", true);
full("G-C1-23", "'d become", false);
for (const [id, ...answers] of [
  ["G-B1-T13", "while", "whilst"],
  ["G-B2-T05", "notwithstanding", "even with"],
]) {
  const core = bank.find((entry) => entry.id === id);
  assert.ok(core, id);
  for (const answer of answers) assert.equal(checkCore(core, answer), true, `${id}: ${answer}`);
}
for (const core of bank) {
  if (core.type === "mcq") {
    assert.ok(core.options && core.options[core.answer!], core.id);
    assert.equal(checkCore(core, core.answer!), true, core.id);
  } else {
    assert.ok(core.accept?.length, core.id);
    for (const accepted of core.accept) assert.equal(checkCore(core, accepted), true, core.id);
  }
}
assert.equal(checkCore({ ...usedTo, type: "mcq", answer: 1 }, 1), true);
assert.equal(checkCore({ ...usedTo, type: "gap", accept: ["he is sleeping"] }, "he's sleeping"), true);
assert.equal(checkCore({ ...usedTo, type: "wordform", accept: ["written"] }, "WRITTEN!"), true);
assert.equal(checkCore({ ...usedTo, type: "transform", accept: ["had gone"] }, "'d gone"), true);
assert.equal(checkCore({ ...usedTo, type: "brackets", accept: ["doesn't go"] }, "does not go"), true);
console.log(`Placement Adult: ${bank.length} заданий ядра, ${fixes.size} Fix и ${bankAlternatives} вариантов Fix. Регрессии проверены.`);
