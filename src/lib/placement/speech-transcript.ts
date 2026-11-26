import "server-only";
import { createHash } from "node:crypto";
import type { PState, SpeakItem } from "./engine";
import { teacherReview } from "./teacher-review";

export function speechSource(st: PState) {
  if (!st.speaking) return "";
  const refs = Object.entries(st.speaking.rec ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify([st.speaking.id, refs])).digest("hex");
}

export function speechTranscript(st: PState, review: ReturnType<typeof teacherReview>) {
  const source = speechSource(st);
  const cached = review.stored.speechTranscript as { source?: string; texts?: string[] } | undefined;
  if (cached?.source === source && Array.isArray(cached.texts)) return { source, texts: cached.texts };
  const item = st.speaking && st.items[st.speaking.id] as SpeakItem | undefined;
  const old = review.active.ai?.speaking ?? review.stored.ai?.speaking ?? review.active.legacyReview?.ai?.speaking;
  // Historical scores did not identify recordings. Reuse those transcripts only for a completed, original task.
  const texts = item && !cached && !st.wsExtra?.speaking && old?.level === item.level && Array.isArray(old.transcripts) &&
    old.transcripts.length === item.questions.length ? old.transcripts : [];
  return { source, texts };
}
