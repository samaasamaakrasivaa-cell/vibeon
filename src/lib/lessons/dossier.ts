import "server-only";
// Досье ученика по темам: из итогов уроков (позже — и мини-проверок, срезов). Свежие уроки весят больше,
// давно не повторявшиеся темы помечаются. Статус по порогу учителя: пробел < порога ≤ на контроле < 90 ≤ освоено.
import { db } from "../db";
import { Prisma } from "@prisma/client";
import type { Check, Notes, TopicStat } from "./summary";

export type DossierTopic = { key: string; name: string; skill?: string; score: number; items: number; lessons: number; last: string; daysAgo: number; trend: number | null; status: "own" | "watch" | "gap" };
export type SummaryView = { id: string; lessonId: string; date: string; title: string; status: string; topics: TopicStat[]; checks: Check[]; notes: Notes };

export const DEFAULT_THRESHOLD = 75;
export const OWN_FROM = 90;

export async function dossier(studentId: string, o: { approvedOnly?: boolean; threshold?: number } = {}) {
  const thr = o.threshold ?? DEFAULT_THRESHOLD;
  const rows = await db.$queryRaw<{ id: string; status: string; lessonId: string; startsAt: Date; title: string | null;
    topics: TopicStat[]; checks: Check[]; notes: Notes }[]>`
    SELECT ls.id, ls.status, l.id AS "lessonId", l."startsAt", t.title, ls.topics, ls.checks,
      jsonb_build_object('hardest', ls.notes -> 'hardest', 'longest', ls.notes -> 'longest',
        'words', ls.notes -> 'words', 'points', ls.notes -> 'points', 'other', ls.notes -> 'other', 'typos', ls.notes -> 'typos') AS notes
    FROM "LessonSummary" ls JOIN "LessonInstance" l ON l.id = ls."lessonInstanceId"
    LEFT JOIN "LessonTemplate" t ON t.id = l."templateId"
    WHERE ls."studentId" = ${studentId} AND ${o.approvedOnly ? Prisma.sql`ls.status = 'approved'` : Prisma.sql`ls.status <> 'analysis-only'`}
    ORDER BY l."startsAt" DESC
  `;
  const now = Date.now();
  const by = new Map<string, { name: string; skill?: string; w: number; ws: number; items: number; lessons: number; last: Date; scores: number[] }>();
  rows.forEach((r, idx) => {
    const decay = Math.pow(0.85, idx); // свежие уроки весят больше
    for (const t of r.topics ?? []) {
      if (t.key === "untagged" || !t.items) continue;
      const x = by.get(t.key) ?? { name: t.name, skill: t.skill, w: 0, ws: 0, items: 0, lessons: 0, last: r.startsAt, scores: [] };
      const w = t.items * decay;
      x.w += w; x.ws += w * t.score; x.items += t.items; x.lessons++; x.scores.push(t.score);
      if (r.startsAt > x.last) x.last = r.startsAt;
      by.set(t.key, x);
    }
  });
  const topics: DossierTopic[] = [...by.entries()].map(([key, x]) => {
    const score = Math.round(x.ws / Math.max(1e-6, x.w));
    return { key, name: x.name, skill: x.skill, score, items: x.items, lessons: x.lessons, last: x.last.toISOString().slice(0, 10), daysAgo: Math.floor((now - x.last.getTime()) / 864e5),
      trend: x.scores.length > 1 ? x.scores[0] - x.scores[1] : null, status: score >= OWN_FROM ? "own" as const : score >= thr ? "watch" as const : "gap" as const };
  }).sort((a, b) => a.score - b.score);
  const summaries: SummaryView[] = rows.map((r) => ({ id: r.id, lessonId: r.lessonId, date: r.startsAt.toISOString(),
    title: r.title ?? "", status: r.status, topics: r.topics, checks: r.checks, notes: r.notes }));
  const words = [...new Set(summaries.flatMap((s) => s.notes?.words ?? []))];
  return { threshold: thr, topics, summaries, words };
}

/** Проведённые уроки без итога (до появления итогов) — их можно собрать кнопкой. */
export async function lessonsWithoutSummary(studentId: string) {
  return db.lessonInstance.findMany({
    where: { studentId, status: "DONE", templateId: { not: null }, summaries: { none: { studentId, status: { not: "analysis-only" } } }, answers: { some: { studentId } } },
    select: { id: true, startsAt: true, template: { select: { title: true } } }, orderBy: { startsAt: "desc" }, take: 10,
  });
}
