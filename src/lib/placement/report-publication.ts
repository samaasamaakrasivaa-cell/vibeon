import "server-only";
import { createHash } from "node:crypto";
import { resolve, type RCfg, type RSaved, type RVariant } from "./report";
import type { ReportDataT } from "./report-data";
import type { ReviewData } from "./review";

// Deploy the compatible reader before enabling snapshot publication.
export const reportPublicationEnabled = false;

// The student surface uses only these parts of the answer review.
export function studentAnswers(d: ReviewData) {
  const text = ({ id, kind, level, title, passage, audio, questions }: ReviewData["reading"][number]) => ({
    id, kind, level, title, passage, audio,
    questions: questions.map(({ id, q, options, answer, given, ok, dk, explain }) => ({ id, q, options, answer, given, ok, dk, explain })),
  });
  return {
    core: d.core.map(({ id, vocab, level, base, type, q, frame, ok, given, dk, right, hinted, topic, explain }) => ({
      id, vocab, level, base, type, q, frame, ok, given, dk, right, hinted, topic, explain,
    })),
    reading: d.reading.map(text), listening: d.listening.map(text),
  };
}
export type StudentAnswers = ReturnType<typeof studentAnswers>;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function listeningRevisions(d: ReviewData) {
  return Object.fromEntries(d.listening.flatMap(({ id, script }) => script ? [[id, sha256(script)]] : []));
}

function reportContent(r: ReportDataT, cfg?: RCfg) {
  const { name, teen, level, skills, families, grammarDetail } = r.input;
  const { lang, on, texts } = resolve(r.input, "student", cfg);
  const writing = r.writing && on.writing
    ? { level: r.writing.level, prompt_en: r.writing.prompt_en, text: r.writing.text, marks: r.writing.marks, note: r.writing.note }
    : null;
  const speaking = on.writing ? r.speaking : null;
  return {
    lang, on: { ...on, answers: false },
    texts: Object.fromEntries(Object.entries(texts).filter(([block]) => on[block as keyof typeof on])),
    sheet: {
      input: { name, teen, level, skills: on.skills ? skills : {}, families: on.grammar && !grammarDetail?.topics.length ? families : [], grammarDetail: on.grammar ? grammarDetail : undefined },
      writing, speaking, max: r.max, date: r.date,
    },
    answers: studentAnswers(r.d),
  };
}

// Compare the fresh report source with the preview opened in the teacher's tab.
export function reportSource(r: ReportDataT, timeZone: string) {
  return sha256(JSON.stringify({ base: reportContent(r), comment: r.input.comment, listening: listeningRevisions(r.d), timeZone }));
}

export function makePublication(r: ReportDataT, cfg: RCfg, id: string, sentAt: string, timeZone: string) {
  return { schema: 1 as const, id, sentAt, timeZone, ...reportContent(r, cfg), listening: listeningRevisions(r.d) };
}
export type ReportPublication = ReturnType<typeof makePublication>;
export function publicationScripts(p: ReportPublication, scripts: Record<string, string>) {
  return Object.fromEntries(Object.entries(scripts).filter(([id, text]) => p.listening[id] === sha256(text)));
}

export type StoredReport = RSaved & {
  draft?: Partial<Record<RVariant, RCfg>>;
  draftIds?: Partial<Record<RVariant, string>>;
  legacySendId?: string;
  publications?: ReportPublication[];
  // Report access follows the explicit teacher switch, not temporary retake status.
  resultVisible?: boolean;
};

export function storedReport(review: unknown): StoredReport {
  const report = (review as { report?: StoredReport } | null)?.report;
  return report && typeof report === "object" && !Array.isArray(report) ? report : {};
}

export function reportDraft(r: StoredReport): RSaved {
  return {
    student: r.draft?.student ?? r.student, parent: r.draft?.parent ?? r.parent,
    sent: r.sent, sentAt: r.sentAt,
  };
}

// Keep every publication on hide; the current publication is the last append.
export function lastPublication(r: StoredReport) {
  return r.publications?.at(-1);
}

export function publicationStamp(r: StoredReport) {
  return { sent: !!r.sent, version: lastPublication(r)?.id ?? r.legacySendId ?? r.sentAt ?? null };
}
export type PublicationStamp = ReturnType<typeof publicationStamp>;
