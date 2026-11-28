import "server-only";
import { createHash } from "node:crypto";
import { readStored } from "../storage";
import type { PState } from "./engine";
import { RUB_V2 } from "./rubric";
import { wsAssessmentSource } from "./ws-assessment";

type RecordingProof = {
  attemptId: string;
  taskId: string;
  question: number;
  reference: string;
  digest: string;
};
type Review = Record<string, unknown>;

export const recordingDigest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function recordSpeakingUpload(review: Review, proof: RecordingProof): Review {
  const stored = review.speakingRecordingsV1 as Record<string, RecordingProof> | undefined;
  return { ...review, speakingRecordingsV1: { ...stored, [proof.question]: proof } };
}

/** All current recordings must originate in the upload for this attempt and question. */
export async function verifiedSpeakingSource(attemptId: string, state: PState, review: Review) {
  const speaking = state.speaking;
  const task = state.items?.[speaking?.id ?? ""];
  if (!speaking || task?.type !== "speaking") return undefined;
  const recordings = Object.entries(speaking.rec ?? {});
  if (!recordings.length || new Set(recordings.map(([, reference]) => reference)).size !== recordings.length) return undefined;

  const proofs = review.speakingRecordingsV1 as Record<string, RecordingProof> | undefined;
  for (const [slot, reference] of recordings) {
    const proof = proofs?.[slot];
    const question = Number(slot);
    if (!Number.isInteger(question) || String(question) !== slot || question < 1 || question > task.questions.length ||
        !proof || proof.attemptId !== attemptId || proof.taskId !== task.id || proof.question !== question || proof.reference !== reference) return undefined;

    const [key, mime, extra] = reference.split("|");
    if (!key || extra !== undefined || !/^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac)$/.test(mime ?? "")) return undefined;
    const file = await readStored(key);
    if (!file?.size || recordingDigest(file.buf) !== proof.digest) return undefined;
  }
  return wsAssessmentSource(state, "speaking", RUB_V2).fingerprint ?? undefined;
}
