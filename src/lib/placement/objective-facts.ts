import "server-only";
import { createHash } from "node:crypto";
import { byLevelOf, PL_LEVELS, skillStep, STEPS, type Ans, type PLevel, type PState, type Q } from "./engine";

type CoreSection = "core" | "vocab";
type TextSection = "reading" | "listening";
type Section = CoreSection | TextSection;
type Skill = "grammar" | "vocabulary" | TextSection;
type Scope = "initial" | "additional";
type GapReason = "not-tested" | "not-confirmed" | "unknown-origin";
type EvidenceItem = { itemId: string; questionIds: string[]; taskLevel: PLevel; topicId?: string };
type Checked = {
  skill: Skill;
  status: "checked";
  scope: Scope;
  correct: number;
  total: number;
  taskLevels: PLevel[];
  level?: typeof STEPS[number];
  topicId?: string;
};
type Evidence = { section: Section; items: EvidenceItem[]; assignedAt?: number };
type Observation = { fact: Checked; evidence: Evidence } | { fact: { skill: Skill; status: "unknown"; reason: GapReason }; evidence?: undefined };

const timestamp = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const unique = (ids: string[]) => new Set(ids).size === ids.length;
const sectionComplete = (state: PState, section: Section) =>
  timestamp(state.sdates?.[section]) || (state.sdates === undefined && state.section === "done");
const gap = (skill: Skill, reason: GapReason): Observation => ({ fact: { skill, status: "unknown", reason } });

function baseScope(state: PState, section: Section, repeated: boolean): Scope | null {
  if (state.parts && !state.parts.includes(section)) return null;
  const added = state.added, completed = state.sdates?.[section];
  if (added === undefined) return "initial";
  // Only the latest addSections event is retained. A retake can also replace the completion date.
  return !repeated && state.parts?.includes(section) && timestamp(added) && timestamp(completed) && completed > added
    ? "additional" : null;
}

function scored(state: PState, items: EvidenceItem[]) {
  const ids = items.flatMap(({ questionIds }) => questionIds);
  return ids.length > 0 && unique(ids) && ids.every((id) => typeof state.answers?.[id]?.ok === "boolean");
}

function textGradeMatches({ options, answer: key }: Q, saved: Ans | undefined) {
  const isOption = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    Array.isArray(options) && value < options.length && typeof options[value] === "string";
  return !!saved && isOption(key) && (saved.v === null || isOption(saved.v)) && saved.ok === (saved.v === key);
}

function checked(state: PState, skill: Skill, scope: Scope, evidence: Evidence, detail: Pick<Checked, "level" | "topicId"> = {}): Observation {
  const ids = evidence.items.flatMap(({ questionIds }) => questionIds);
  const fact: Checked = {
    skill, status: "checked", scope, correct: ids.filter((id) => state.answers[id].ok).length, total: ids.length,
    taskLevels: PL_LEVELS.filter((level) => evidence.items.some((item) => item.taskLevel === level)), ...detail,
  };
  return { fact, evidence };
}

function collectCore(state: PState, section: CoreSection): Observation[] {
  const skill = section === "core" ? "grammar" : "vocabulary";
  const extraPhase = section === "core" ? "z" : "vz";
  const entries = (state.core ?? []).filter(({ id, ph }) => {
    const item = state.items?.[id];
    if (item?.skill === "grammar" || item?.skill === "vocabulary") return item.skill === skill;
    return !ph || (section === "vocab" ? ph.startsWith("v") : !ph.startsWith("v"));
  });
  const history = (state.xs ?? []).filter(({ kind }) => kind === section);
  const active = state.xq?.kind === section ? state.xq : undefined;
  const pending = active ? new Set(active.ids) : null;
  const repeated = entries.filter(({ ph }) => ph === extraPhase);
  const base = entries.filter(({ id, ph }) => ph !== extraPhase && !pending?.has(id));
  if (!entries.length && !pending && !history.length) return [gap(skill, timestamp(state.sdates?.[section]) ? "unknown-origin" : "not-tested")];
  if (!unique(entries.map(({ id }) => id)) ||
      entries.some(({ ph }) => (ph === "z" || ph === "vz") && ph !== extraPhase)) return [gap(skill, "unknown-origin")];
  if (!sectionComplete(state, section)) return [gap(skill, "not-confirmed")];

  const evidenceOf = (id: string): EvidenceItem | null => {
    const item = state.items?.[id];
    return item?.id === id && item.skill === skill && item.topic_id && PL_LEVELS.includes(item.level)
      ? { itemId: id, questionIds: [id], taskLevel: item.level, topicId: item.topic_id } : null;
  };
  const observations: Observation[] = [];
  if (base.length) {
    const items = base.map(({ id }) => evidenceOf(id)).filter((item) => item !== null);
    const scope = baseScope(state, section, history.length > 0 || repeated.length > 0 || pending !== null);
    if (!scope || items.length !== base.length || !scored(state, items)) observations.push(gap(skill, "unknown-origin"));
    else {
      const step = section === "core" ? state.step : state.vstep;
      const level = typeof step === "number" && Number.isInteger(step) ? STEPS[step] : undefined;
      observations.push(checked(state, skill, scope, { section, items }, level ? { level } : {}));
      for (const topicId of new Set(items.map((item) => item.topicId))) {
        observations.push(checked(state, skill, scope, { section, items: items.filter((item) => item.topicId === topicId) }, { topicId }));
      }
    }
  }
  // The active assignment is appended to history and can legitimately follow an earlier completion.
  const finishedHistory = active && history.at(-1)?.level === active.level ? history.slice(0, -1) : history;
  const completedAt = state.sdates?.[section];
  const inconsistentHistory = timestamp(completedAt) && finishedHistory.some(({ at }) => timestamp(at) && at > completedAt);
  // Phase markers cannot tie an extra item to an individual assignment with consistent dates.
  for (const { id } of repeated) {
    if (pending?.has(id)) continue;
    const item = evidenceOf(id);
    observations.push(!inconsistentHistory && item && scored(state, [item])
      ? checked(state, skill, "additional", { section, items: [item] }, { topicId: item.topicId })
      : gap(skill, "unknown-origin"));
  }
  if (pending) observations.push(gap(skill, "not-confirmed"));
  else if (history.length && !repeated.length) observations.push(gap(skill, "unknown-origin"));
  return observations;
}

function collectTexts(state: PState, section: TextSection): Observation[] {
  const ids = state[section] ?? [];
  const done = (section === "reading" ? state.rdone : state.ldone) ?? [];
  const history = (state.xs ?? []).filter(({ kind }) => kind === section);
  const pending = state.xt?.kind === section;
  if (!ids.length && !done.length && !history.length && !pending) {
    return [gap(section, timestamp(state.sdates?.[section]) ? "unknown-origin" : "not-tested")];
  }
  // Every extra assignment appends exactly one text. Only a consistent suffix can be attributed.
  if (!unique(ids) || !unique(done) || done.some((id, index) => ids[index] !== id) ||
      history.length > ids.length || (pending && !history.length)) return [gap(section, "unknown-origin")];
  const extraStart = ids.length - history.length;
  if (extraStart > 3) return [gap(section, "unknown-origin")];
  const aligned = history.every(({ level, at }, index) => timestamp(at) && (index === 0 || history[index - 1].at <= at) &&
    state.items?.[ids[extraStart + index]]?.level === level);
  if (!aligned || (pending && state.items?.[ids.at(-1)!]?.level !== state.xt?.level)) return [gap(section, "unknown-origin")];
  if (!sectionComplete(state, section)) return [gap(section, "not-confirmed")];
  const lastFinished = history.at(pending ? -2 : -1), completedAt = state.sdates?.[section];
  if (lastFinished && timestamp(completedAt) && lastFinished.at > completedAt) return [gap(section, "unknown-origin")];

  const evidence = ids.map((id): EvidenceItem | null => {
    const item = state.items?.[id];
    return item?.id === id && item.type === section && item.skill === section && PL_LEVELS.includes(item.level) && item.questions?.length
      ? { itemId: id, taskLevel: item.level, questionIds: item.questions.map((question) => question.id) } : null;
  });
  if (!unique(evidence.flatMap((item) => item?.questionIds ?? []))) return [gap(section, "unknown-origin")];
  const completed = new Set(done);
  const textFact = (start: number, end: number, scope: Scope | null, assignedAt?: number) => {
    if (pending && end === ids.length || ids.slice(start, end).some((id) => !completed.has(id))) return gap(section, "not-confirmed");
    const items = evidence.slice(start, end).filter((item) => item !== null);
    if (!scope || items.length !== end - start || !scored(state, items)) return gap(section, "unknown-origin");
    const gradesMatch = items.every(({ itemId }) => {
      const item = state.items[itemId];
      return item.type === section && item.questions.every((question) => textGradeMatches(question, state.answers[question.id]));
    });
    if (!gradesMatch) return gap(section, "unknown-origin");
    const step = skillStep(byLevelOf(state, items.map(({ itemId }) => itemId)));
    return checked(state, section, scope, { section, items, ...(assignedAt !== undefined ? { assignedAt } : {}) },
      step === null ? {} : { level: STEPS[step] });
  };
  const observations = extraStart ? [textFact(0, extraStart, baseScope(state, section, history.length > 0))] : [];
  for (const [index, entry] of history.entries()) observations.push(textFact(extraStart + index, extraStart + index + 1, "additional", entry.at));
  return observations;
}

/** The caller supplies state from the owned, submitted attempt. Evidence is for server-side lookup. */
export function collectObjectiveFacts(state: PState) {
  const observations = [...collectCore(state, "core"), ...collectCore(state, "vocab"), ...collectTexts(state, "reading"), ...collectTexts(state, "listening")];
  const evidence: Record<string, Evidence> = {};
  const facts = observations.map(({ fact, evidence: source }, index) => {
    const factId = `F${index + 1}`;
    if (source) evidence[factId] = source;
    return { factId, ...fact };
  });
  const inputs = [...new Set(Object.values(evidence).flatMap(({ items }) => items.map(({ itemId }) => itemId)))];
  const revision = createHash("sha256").update(JSON.stringify([
    facts, evidence,
    inputs.map((id) => state.items[id]),
    [...new Set(Object.values(evidence).flatMap(({ items }) => items.flatMap(({ questionIds }) => questionIds)))]
      .map((id) => [id, state.answers[id]?.v, state.answers[id]?.ok]),
  ], (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value)).digest("hex");
  return { revision, facts, evidence };
}
