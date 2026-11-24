// Виды самостоятельных слотов ученика: цвет в расписании, значок, идёт ли время в часы маршрута.
// Домашка и слова уже учитываются в маршруте сами (по ответам и тренировкам) — их слоты второй раз не засчитываем.
import type { IconName } from "@/components/icon-paths";

export const STUDY_KINDS = ["homework", "words", "film", "podcast", "reading", "speaking", "grammar", "club", "exam"] as const;
export type StudyKind = (typeof STUDY_KINDS)[number];

export const KIND: Record<StudyKind, { color: string; icon: IconName; self: boolean; dur: number }> = {
  homework: { color: "#FF9F0A", icon: "clip", self: false, dur: 45 },
  words: { color: "#30B0C7", icon: "cards", self: false, dur: 10 },
  film: { color: "#BF5AF2", icon: "video", self: true, dur: 45 },
  podcast: { color: "#AC8E68", icon: "sound", self: true, dur: 30 },
  reading: { color: "#34C759", icon: "book", self: true, dur: 30 },
  speaking: { color: "#FF6482", icon: "mic", self: true, dur: 30 },
  grammar: { color: "#5E5CE6", icon: "pencil", self: true, dur: 30 },
  club: { color: "#FF375F", icon: "users", self: true, dur: 60 },
  exam: { color: "#64D2FF", icon: "target", self: true, dur: 60 },
};

/** Сделанное вручную засчитывается в маршрут не больше 90 минут в день (чтобы прогноз не уезжал от случайных отметок). */
export const SELF_CAP_MIN = 90;

/** Слова: минут на тренировку по цели дня (≈ 30 секунд на слово, как в маршруте). */
export const wordsMin = (goal: number) => Math.max(5, Math.round(goal * 0.5));

export const isKind = (k: string): k is StudyKind => (STUDY_KINDS as readonly string[]).includes(k);
