import { liteCorrect } from "../ai/lite";
import { describe5, RUB_V2 } from "./rubric";

export type ResponseEdit = {
  part: number; start: number; end: number; original: string; corrected: string; criterion: string; explanation: string;
};
export type PlacementScore = {
  scores: Record<string, number | null>; why: Record<string, string>; summary: string;
  edits?: ResponseEdit[]; unplaced?: number;
};
export type ScoreInput = {
  kind: "writing" | "speaking"; level: string; below: string; teen?: boolean; task: string;
  answers: string[]; criteria: { id: string; name: string; en?: string; level: string; below: string; bands?: string[] }[]; max?: number;
};
const object = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const short = (x: unknown, max: number) => typeof x === "string" ? x.trim().slice(0, max) : "";

/** Стабильная ссылка на дословную фразу. Работает и для расшифровки без пунктуации. */
export function answerPassages(answers: string[]) {
  return answers.map((text, i) => {
    const chunks = (text.match(/[^.!?\n]+[.!?]*|[.!?]+/g) ?? []).flatMap((s) => s.match(/\S+(?:[^\S\n]+\S+){0,23}/g) ?? []);
    return chunks.map((text, j) => ({ id: `A${i + 1}S${j + 1}`, text }));
  });
}

// The model quotes a numbered answer. Resolve its position against the original, including whitespace and punctuation.
export function parseScore(raw: unknown, input: ScoreInput): PlacementScore {
  const result = object(raw), scores: PlacementScore["scores"] = {}, why: PlacementScore["why"] = {};
  const edits: ResponseEdit[] = [];
  const references = new Map(answerPassages(input.answers).flat().map((p) => [p.id, p.text]));
  const answered = input.answers.some((a) => a.trim());
  for (const c of input.criteria) {
    if (input.kind === "speaking" && c.id === "pronunciation") {
      scores[c.id] = null;
      continue;
    }
    const v = object(result.scores)[c.id];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > (input.max ?? 5)) throw new Error("Invalid placement score");
    scores[c.id] = answered ? v : 0;
    if (!answered) { why[c.id] = "Ответ отсутствует."; continue; }
    const rows = object(result.evidence)[c.id];
    const comments: string[] = [];
    const feedback = Array.isArray(rows) ? rows : [rows];
    for (const value of feedback.slice(0, 3)) {
      const row = object(value), source = input.answers[Number(row.part) - 1];
      const passage = references.get(short(row.source, 32).toUpperCase());
      const candidate = short(row.quote, 400), comment = short(row.comment, 580);
      // При неточно переписанной цитате берём оригинал по ссылке, которую выбрала модель.
      const quoted = candidate && (passage ?? source ? (passage ?? source).includes(candidate) : input.answers.some((a) => a.includes(candidate)));
      const quote = quoted ? candidate : passage;
      if (quote && comment) comments.push(`«${quote}» — ${comment}`);
    }
    if (!comments.length) throw new Error("Missing evidence for " + c.id);
    why[c.id] = comments.join("\n").slice(0, 1500);
  }
  if (!Array.isArray(result.edits)) throw new Error("Missing placement corrections");
  let unplaced = 0;
  for (const value of result.edits) {
    const row = object(value), part = Number(row.part) - 1, source = input.answers[part];
    const original = short(row.original, 500), corrected = short(row.corrected, 700);
    const criterion = short(row.criterion, 40), explanation = short(row.explanation, 700);
    if (!source || !original || typeof row.corrected !== "string" || original === corrected || !explanation ||
        !input.criteria.some((c) => c.id === criterion) || (input.kind === "speaking" && criterion === "pronunciation")) { unplaced++; continue; }
    let start = source.indexOf(original);
    const occurrence = Number(row.occurrence ?? 1);
    if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > source.length ||
        (row.occurrence == null && source.indexOf(original, start + original.length) >= 0)) { unplaced++; continue; }
    for (let n = 1; n < occurrence && start >= 0; n++) start = source.indexOf(original, start + original.length);
    const end = start + original.length;
    if (start < 0 || edits.some((e) => e.part === part && e.start < end && e.end > start)) { unplaced++; continue; }
    edits.push({ part, start, end, original, corrected, criterion, explanation });
  }
  return { scores, why, summary: short(result.summary, 1200), edits: edits.sort((a, b) => a.part - b.part || a.start - b.start), unplaced };
}

export function mockScore(input: ScoreInput) {
  const first = input.answers.findIndex((x) => x.trim());
  const quote = input.answers[first]?.trim().match(/^(?:\S+\s*){1,7}/)?.[0].trim() ?? "";
  const words = input.answers.join(" ").trim().split(/\s+/).filter(Boolean).length;
  const base = !words ? 0 : words < 25 ? 1 : words < 50 ? 3 : (input.max ?? 5);
  const edits = input.answers.flatMap((answer, i) => liteCorrect(answer).notes.filter((n) => input.kind === "writing" || !/орфограф|букв|точк|написани|пробел|знак/i.test(n.why)).map((n) => ({
    part: i + 1, original: n.from, corrected: n.to, criterion: input.kind === "writing" ? "language" : "grammar", explanation: n.why,
  })));
  return parseScore({ scores: Object.fromEntries(input.criteria.map((c) => [c.id, base])),
    evidence: Object.fromEntries(input.criteria.map((c) => [c.id, [{ part: first + 1, quote: quote, comment: "Пример для проверки интерфейса." }]])),
    summary: "Пробная оценка без подключения модели.", edits }, input);
}

/** Заменяем прежнюю подсказку ИИ или шаблон шкалы; текст, написанный учителем, сохраняем. */
export function applyScore(kind: ScoreInput["kind"], level: string, result: PlacementScore,
  current: Record<string, number> = {}, notes: Record<string, string> = {}, previous?: PlacementScore) {
  const marks = { ...current }, comments = { ...notes };
  for (const c of RUB_V2[kind]) {
    const score = result.scores[c.id];
    if (typeof score !== "number") continue;
    const old = current[c.id], note = notes[c.id]?.trim();
    marks[c.id] = score;
    if (result.why[c.id] && (!note || note === previous?.why[c.id] || (typeof old === "number" && note === describe5(c, level, old)))) {
      comments[c.id] = result.why[c.id];
    }
  }
  return { marks, comments };
}
