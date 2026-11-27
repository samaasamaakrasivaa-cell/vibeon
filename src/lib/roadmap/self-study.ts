import "server-only";
import { SS_SKILLS, type SelfStudy } from "../ai/route-core";
import { parsePace } from "./math";

type SelfStudySource = {
  approvedAt: Date | null;
  meta: unknown;
  aiDraft: unknown;
  pace: string | null;
  paceStudent: string | null;
};

export function sharesSelfStudy(roadmap: Pick<SelfStudySource, "approvedAt" | "meta">) {
  const shared = (roadmap.meta as { share?: { self?: boolean } } | null)?.share?.self;
  return !!roadmap.approvedAt && (shared == null || shared === true);
}

/** The student sees the same approved plan and pace in the route and in the calendar. */
export function publishedSelfStudy(roadmap: SelfStudySource | null): SelfStudy | null {
  if (!roadmap || !sharesSelfStudy(roadmap)) return null;
  const plan = (roadmap.aiDraft as { self_study?: SelfStudy } | null)?.self_study;
  if (!Array.isArray(plan?.items)) return null;
  const target = parsePace(roadmap.paceStudent ?? roadmap.pace).min * 7;
  if (!Number.isFinite(target)) return null;
  const original = plan.minutes_per_week > 0 && Number.isFinite(plan.minutes_per_week) ? plan.minutes_per_week : target || 1;
  const items = plan.items.flatMap((item) => {
    if (!item || typeof item.activity !== "string" || !item.activity.trim() ||
        !Number.isFinite(item.minutes) || item.minutes <= 0 ||
        !Number.isInteger(item.times_per_week) || item.times_per_week < 1 || item.times_per_week > 7) return [];
    return [{
      skill: SS_SKILLS.includes(item.skill) ? item.skill : "vocabulary" as const,
      activity: item.activity,
      times_per_week: item.times_per_week,
      how: typeof item.how === "string" ? item.how : "",
      search: typeof item.search === "string" ? item.search : "",
      why: "",
      minutes: Math.max(5, Math.round((item.minutes * target / original) / 5) * 5),
    }];
  });
  if (!items.length) return null;
  return {
    minutes_per_week: items.reduce((total, item) => total + item.minutes * item.times_per_week, 0),
    items,
    tips: Array.isArray(plan.tips) ? plan.tips.filter((tip) => typeof tip === "string") : [],
  };
}
