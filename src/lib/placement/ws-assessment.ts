import "server-only";
import { createHash } from "node:crypto";
import type { PlacementScore } from "./ai-feedback";
import type { PState } from "./engine";
import type { RubricSet } from "./rubric";

type Skill = "writing" | "speaking";
type Review = Record<string, unknown>;
type Source = {
  kind: Skill;
  fingerprint: string | null;
  hasAnswer: boolean;
  criteria: string[];
  max: number;
};
type Marks = Record<string, number>;
type Run = { id: string; sequence: number };
type Draft = { requestId: string; requestSequence: number; score: PlacementScore; at: string };
type Confirmation = { marks: Marks; comments?: Record<string, string>; note?: string; teacherId: string; at: string };
type ArchivedConfirmation = { source: string | null; generation: number; confirmation: Confirmation; reason: "source-changed" | "reopened" };
type Block = {
  source: string | null;
  generation: number;
  request: (Run & { status: "pending" | "complete" | "failed" }) | null;
  draft: Draft | null;
  confirmation: Confirmation | null;
  history: ArchivedConfirmation[];
};
type Assessment = { schema: 1 } & Partial<Record<Skill, Block>>;
type Change = { type: "sync" } | ({ generation: number } & (
  | { type: "request"; id: string; previousSequence: number | null }
  | (Run & ({ type: "result"; score: PlacementScore; at: string } | { type: "failure" }))
  | { type: "confirm"; confirmation: Confirmation }
  | { type: "reopen" }
));

export function wsAssessmentSource(st: Pick<PState, "items" | "writing" | "speaking">, kind: Skill, rubric: RubricSet): Source {
  const criteria = rubric[kind].map(({ id }) => id);
  const source = { kind, criteria, max: rubric.max, fingerprint: null, hasAnswer: false };
  const item = st.items?.[st[kind]?.id ?? ""];
  if (!item || item.type !== kind) return source;

  const task = item.type === "writing"
    ? [item.prompt_en, item.prompt_ru, item.points, item.min_words, item.max_words, item.time_min]
    : [item.intro_ru, item.questions.map(({ q, prep_sec, speak_sec }) => [q, prep_sec, speak_sec])];
  const answers = item.type === "writing"
    ? [st.writing?.text ?? ""]
    : item.questions.map((_, index) => st.speaking?.rec?.[String(index + 1)] ?? "");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([kind, item.id, item.level, item.band, task, item.expects, answers, rubric.ver, rubric.max, rubric[kind]]))
    .digest("hex");
  return { ...source, fingerprint, hasAnswer: answers.some((answer) => answer.trim().length > 0) };
}

function assessmentOf(review: Review): Assessment | null {
  const value = review.wsAssessment as Assessment | null | undefined;
  if (value == null) return { schema: 1 };
  return value.schema === 1 ? value : null;
}

function archive(block: Block, reason: ArchivedConfirmation["reason"]): ArchivedConfirmation[] {
  if (!block.confirmation) return block.history;
  return [...block.history, { source: block.source, generation: block.generation, confirmation: block.confirmation, reason }];
}

export function readWsAssessment(review: Review, source: Source) {
  const block = assessmentOf(review)?.[source.kind];
  const current = block?.source === source.fingerprint ? block : undefined;
  const history = !block ? [] : current ? current.history : archive(block, "source-changed");
  const last = history.at(-1);
  const stale = last && (last.reason === "source-changed" || last.source !== source.fingerprint);
  return {
    generation: current?.generation ?? null,
    request: current?.request ?? null,
    draft: current?.draft ?? null,
    confirmation: current?.confirmation ?? null,
    staleConfirmation: !current?.confirmation && stale ? last.confirmation : null,
    history,
  };
}

function validMarks(source: Source, marks: Marks) {
  return Object.keys(marks).length === source.criteria.length &&
    source.criteria.every((id) => Number.isInteger(marks[id]) && marks[id] >= 0 && marks[id] <= source.max);
}

/** Apply one skill's transition to a fresh review. Returning the same review means there is no write. */
export function updateWsAssessment(review: Review, source: Source, change: Change): Review {
  const assessment = assessmentOf(review);
  if (!assessment) return review;
  const block = assessment[source.kind];
  const save = (next: Block): Review => ({ ...review, wsAssessment: { ...assessment, [source.kind]: next } });
  if (change.type === "sync") {
    if (block?.source === source.fingerprint || (!block && source.fingerprint === null)) return review;
    return save({
      source: source.fingerprint, generation: (block?.generation ?? 0) + 1,
      request: null, draft: null, confirmation: null, history: block ? archive(block, "source-changed") : [],
    });
  }
  if (!block || block.source !== source.fingerprint || block.generation !== change.generation) return review;
  if (change.type === "reopen") {
    if (!block.confirmation) return review;
    return save({ ...block, generation: block.generation + 1, request: null, confirmation: null, history: archive(block, "reopened") });
  }
  if (!source.hasAnswer || block.confirmation) return review;
  if (change.type === "confirm") {
    if (!validMarks(source, change.confirmation.marks)) return review;
    return save({ ...block, request: null, confirmation: structuredClone(change.confirmation) });
  }
  const request = block.request;
  if (change.type === "request") {
    const previousSequence = request?.sequence ?? null;
    if (!change.id || request?.id === change.id || previousSequence !== change.previousSequence) return review;
    return save({ ...block, request: { id: change.id, sequence: (previousSequence ?? 0) + 1, status: "pending" } });
  }
  if (request?.status !== "pending" || request.id !== change.id || request.sequence !== change.sequence) return review;
  if (change.type === "failure") return save({ ...block, request: { ...request, status: "failed" } });
  return save({
    ...block, request: { ...request, status: "complete" },
    draft: { requestId: request.id, requestSequence: request.sequence, score: structuredClone(change.score), at: change.at },
  });
}
