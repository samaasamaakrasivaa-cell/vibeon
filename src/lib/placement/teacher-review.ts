// Старый результат остаётся источником для кабинета ученика и маршрута до утверждения
// новой проверки. Открытие учительской страницы ничего не записывает.
import { RUB_V2, rubricOf } from "./rubric";
import type { PlScore } from "../ai/tasks";

type Marks = Record<string, number>;
type Assessment = {
  writing?: Marks; speaking?: Marks; lesson?: { level: string; marks: Marks } | null;
  wc?: Record<string, string>; sc?: Record<string, string>;
  ai?: Partial<Record<"writing" | "speaking", PlScore & { level?: string; transcripts?: string[] }>>;
  points?: boolean[]; comment?: string; wNote?: string; sNote?: string;
};
type LegacyReview = Assessment & { rubric: 1; at?: string; level: string | null };
type StoredReview = Assessment & Record<string, unknown> & { rubric?: number; cambridgeDraft?: Assessment; legacyReview?: LegacyReview };
type Attempt = { review: unknown; level: string | null; reviewedAt: Date | null };

export function teacherReview(a: Attempt) {
  const stored = (a.review ?? {}) as StoredReview;
  // До версионирования ручные баллы записывались без номера шкалы. У говорения
  // три ключа пересекаются; новые ручные оценки уже всегда содержат rubric: 2.
  const manualMarks = [stored.writing, stored.speaking, stored.lesson?.marks].some((m) => Object.keys(m ?? {}).length > 0);
  const aiRubric = rubricOf({ writing: stored.ai?.writing?.scores, speaking: stored.ai?.speaking?.scores });
  const regrading = rubricOf(stored).ver === 1 || (stored.rubric == null && (manualMarks || aiRubric.ver === 1));
  const { cambridgeDraft = {}, ...original } = stored;
  const { writing, speaking, wc, sc, lesson, ai, ...common } = original;
  const legacyReview: LegacyReview = stored.legacyReview ?? { rubric: 1, at: a.reviewedAt?.toISOString(), level: a.level, writing, speaking, wc, sc, lesson, ai };
  const active: StoredReview = regrading ? { ...common, rubric: 2, legacyReview, ...cambridgeDraft } : original;
  function edit(patch: Assessment): StoredReview {
    return regrading ? { ...stored, cambridgeDraft: { ...cambridgeDraft, ...patch } } : { ...active, rubric: 2, ...patch };
  }
  return { active, stored, regrading, edit };
}

/** Перед заменой прежних оценок заново проверяются навыки, по которым были выставлены баллы. */
export function missingReassessment(stored: StoredReview, active: Assessment) {
  const scored = (m?: Marks) => Object.values(m ?? {}).some((v) => typeof v === "number");
  const complete = (kind: "writing" | "speaking", m?: Marks) => RUB_V2[kind].every((c) => Number.isInteger(m?.[c.id]));
  if (scored(stored.writing) && !complete("writing", active.writing)) return "writing";
  if ((scored(stored.speaking) || scored(stored.lesson?.marks)) &&
      !complete("speaking", active.speaking) && !complete("speaking", active.lesson?.marks)) return "speaking";
  return null;
}
