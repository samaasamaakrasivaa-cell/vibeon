import "server-only";
import type { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../auth/session";
import { sha256 } from "../auth/crypto";
import { db } from "../db";
import { requestPaymentOcr } from "../ai/providers";
import { type PaymentArtifact, readPaymentOcr } from "./payment-artifacts";

// A separate PostgreSQL lock limits OCR across all app processes sharing the
// database. The one-shot attempt row commits before any provider call.
const ocrLock = 54290317;

export async function runPaymentOcr(
  uploadId: string,
  where: Prisma.InvoiceWhereInput,
  artifact: NonNullable<PaymentArtifact["ocr"]>,
  ctx: { userId: string; teacherId: string },
  matchesAmount: (text: string) => boolean,
) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { code: "STALE", matches: false };
  const tokenHash = sha256(token);
  return db.$transaction(async (tx) => {
    const [slot] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(${ocrLock}::bigint) AS acquired`;
    if (!slot?.acquired) return { code: "BUSY", matches: false };
    const authorized = () => tx.invoice.findFirst({
      where: { AND: [where, { student: { user: { role: "STUDENT", sessions: { some: {
        tokenHash, expiresAt: { gt: new Date() },
      } } } } }] },
      select: { id: true },
    });
    if (!await authorized()) return { code: "STALE", matches: false };
    const bytes = await readPaymentOcr(artifact);
    if (!bytes) return { code: "DAMAGED", matches: false };
    if (!await authorized()) return { code: "STALE", matches: false };
    const start = Date.now();
    const result = await requestPaymentOcr(bytes, artifact.mime);
    const matches = result.code === "OK" && matchesAmount(result.text);
    await tx.aiCall.create({
      data: { userId: ctx.userId, teacherId: ctx.teacherId, provider: result.provider, kind: "ocr",
        model: "payment:1", ok: result.code === "OK" || result.code === "EMPTY", ms: Date.now() - start },
    });
    await tx.paymentOcrAttempt.update({
      where: { uploadId },
      data: { code: result.code, provider: result.provider, matches, completedAt: new Date() },
    });
    return { code: result.code, matches };
  }, { timeout: 20_000 }).catch(() => ({ code: "FAILED", matches: false }));
}
