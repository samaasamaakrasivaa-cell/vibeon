import { addDaysIso, fromZoned, mondayOf, parseIsoDay } from "../time";
import type { SelfItem } from "../ai/route-core";
import { isKind, type StudyKind } from "./kinds";

export type StudyRecommendation = {
  minutes: number;
  items: { skill: SelfItem["skill"]; activity: string; minutes: number; times: number }[];
};

type DraftKind = Exclude<StudyKind, "words">;
export type DraftSlot = { kind: DraftKind; title: string; day: number; startMin: number; durMin: number };
export type WeekDraft = { slots: DraftSlot[]; missed: number; revision: string };
export type BusyInterval = { start: number; end: number; wallStart: number; wallEnd: number };
export type PlannedActivity = { kind: string; title: string | null };

export const isDraftKind = (kind: string): kind is DraftKind => isKind(kind) && kind !== "words";

export function isWeekStart(value: string) {
  if (typeof value !== "string") return false;
  const day = parseIsoDay(value);
  return !!day && addDaysIso(value, 0) === value && mondayOf(value) === value;
}

export function activityKind(skill: string, activity: string): DraftKind | null {
  switch (skill) {
    case "vocabulary": return null;
    case "listening": return /видео|сериал|фильм|\bvideo\b|\bfilm\b|\bmovie\b/i.test(activity) && !/подкаст|podcast/i.test(activity) ? "film" : "podcast";
    case "speaking": return /разговорн.*клуб|conversation club|speaking club/i.test(activity) ? "club" : "speaking";
    case "reading": return "reading";
    case "grammar": return "grammar";
    default: return "other";
  }
}

export function localInterval(date: string, startMin: number, durMin: number, tz: string): BusyInterval {
  const { y, m, d } = parseIsoDay(date)!;
  const start = fromZoned(y, m, d, Math.floor(startMin / 60), startMin % 60, tz).getTime();
  const wallStart = Date.UTC(y, m - 1, d, 0, startMin);
  return { start, end: start + durMin * 60_000, wallStart, wallEnd: wallStart + durMin * 60_000 };
}

// The calendar also needs non-overlapping wall times when the clock repeats an hour.
export const overlaps = (a: BusyInterval, b: BusyInterval) =>
  (a.start < b.end && b.start < a.end) || (a.wallStart < b.wallEnd && b.wallStart < a.wallEnd);
export const activityTitle = (value: string) => value.trim().slice(0, 80).trimEnd();
export const activityKey = (slot: PlannedActivity) => JSON.stringify([slot.kind, slot.title === null ? null : activityTitle(slot.title)]);

export function remainingActivities(items: StudyRecommendation["items"], existing: PlannedActivity[]) {
  const counts = new Map<string, number>();
  for (const slot of existing) {
    const key = activityKey(slot);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return items.flatMap((item) => {
    const kind = activityKind(item.skill, item.activity);
    if (!kind) return [];
    const title = activityTitle(item.activity);
    const key = activityKey({ kind, title });
    const existingCount = counts.get(key) ?? 0;
    counts.set(key, Math.max(0, existingCount - item.times));
    return [{ kind, title, minutes: item.minutes, needed: Math.max(0, item.times - existingCount) }];
  });
}

// Prefer familiar evening hours, then search the remaining times on a five-minute grid.
const evening = 19 * 60;
const dayStarts = Array.from({ length: (22 - 8) * 12 }, (_, i) => 8 * 60 + i * 5)
  .sort((a, b) => Math.abs(a - evening) - Math.abs(b - evening));

export function draftWeek(items: StudyRecommendation["items"], monday: string, tz: string, now: number, busy: BusyInterval[], existing: PlannedActivity[]) {
  const days = Array.from({ length: 7 }, (_, i) => i);
  const dates = days.map((day) => addDaysIso(monday, day));
  const limits = dates.map((date) => localInterval(date, 22 * 60, 0, tz).start);
  const occupied = [...busy];
  const slots: DraftSlot[] = [];
  let missed = 0;

  remainingActivities(items, existing).forEach(({ kind, title, minutes, needed }, index) => {
    const itemDays = new Set<number>();
    for (let session = 0; session < needed; session++) {
      const preferred = (Math.floor((session * 7) / needed) + index) % 7;
      const orderedDays = [...days].sort((a, b) =>
        Number(itemDays.has(a)) - Number(itemDays.has(b)) ||
        slots.filter((s) => s.day === a).length - slots.filter((s) => s.day === b).length ||
        Math.abs(a - preferred) - Math.abs(b - preferred));
      if (minutes > 240) { missed++; continue; }
      let placed = false;
      for (const day of orderedDays) {
        if (limits[day] <= now) continue;
        const startMin = dayStarts.find((start) => {
          const range = localInterval(dates[day], start, minutes, tz);
          return range.start > now && range.end <= limits[day] && !occupied.some((block) => overlaps(range, block));
        });
        if (startMin === undefined) continue;
        slots.push({ day, startMin, durMin: minutes, kind, title });
        occupied.push(localInterval(dates[day], startMin, minutes, tz));
        itemDays.add(day);
        placed = true;
        break;
      }
      if (!placed) missed++;
    }
  });
  return { slots: slots.sort((a, b) => a.day - b.day || a.startMin - b.startMin), missed };
}
