import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const draftLifetimeMs = 60 * 60 * 1_000;
const draftPattern = /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.(\d{13})\.([A-Za-z0-9_-]{43})$/;

function signingSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  return secret && secret.length >= 32 && secret !== "сгенерировать_длинную_случайную_строку" ? secret : null;
}

function draftSignature(secret: string, teacherId: string, courseId: string, id: string, expiresAt: string) {
  return createHmac("sha256", secret)
    .update(JSON.stringify(["course-outline-v1", teacherId, courseId, id, expiresAt]))
    .digest("base64url");
}

export function issueCourseOutlineDraft(teacherId: string, courseId: string, now = Date.now()) {
  const secret = signingSecret();
  if (!secret) return null;
  const id = randomUUID();
  const expiresAt = String(now + draftLifetimeMs);
  const signature = draftSignature(secret, teacherId, courseId, id, expiresAt);
  return `${id}.${expiresAt}.${signature}`;
}

export function verifyCourseOutlineDraft(draft: unknown, teacherId: string, courseId: string, now = Date.now()) {
  const secret = signingSecret();
  const match = typeof draft === "string" && draft.length <= 94 ? draftPattern.exec(draft) : null;
  if (!secret || !match) return null;
  const [, id, expiresAt, signature] = match;
  if (Number(expiresAt) <= now) return null;
  const expected = draftSignature(secret, teacherId, courseId, id, expiresAt);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) ? id : null;
}
