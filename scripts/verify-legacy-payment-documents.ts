import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { inspectPaymentDocument } from "../src/lib/billing/document-content";
import { persistPaymentArtifact, readLegacyPaymentInput, removePaymentArtifact } from "../src/lib/billing/payment-artifacts";
import { fileUrl } from "../src/lib/storage";

// Run with the public routes closed and a qualified validator. Original keys
// and invoice values remain unchanged; retries skip already verified records.
async function main() {
  if (process.argv[2] !== "--apply" || !process.env.DATABASE_URL || !process.env.UPLOAD_DIR || !process.env.PAYMENT_VALIDATOR_SOCKET) {
    throw new Error("Supply --apply and explicit DATABASE_URL, UPLOAD_DIR, PAYMENT_VALIDATOR_SOCKET");
  }
  let checked = 0;
  let unavailable = 0;
  let cursor: string | undefined;
  while (true) {
    const rows = await db.upload.findMany({
      where: { paymentKind: { in: ["PROOF", "RECEIPT"] }, paymentArtifact: { equals: Prisma.DbNull } },
      orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      if (!row.paymentInvoiceId) continue;
      const invoice = await db.invoice.findUnique({ where: { id: row.paymentInvoiceId }, include: { student: true } });
      const proof = row.paymentKind === "PROOF";
      if (!invoice || (proof ? invoice.proofFile : invoice.receiptFile) !== fileUrl(row.path) ||
          (proof ? invoice.student.userId : invoice.student.teacherId) !== row.ownerId) continue;
      const input = await readLegacyPaymentInput(row.path, row.size);
      const result = input ? await inspectPaymentDocument(input, row.mime) : { error: "unavailable" as const };
      if ("error" in result) {
        if (result.error === "busy") throw new Error("Validator unavailable; resume after it is healthy");
        await db.upload.updateMany({ where: { id: row.id, paymentArtifact: { equals: Prisma.DbNull } },
          data: { paymentArtifact: { unavailable: true } } });
        unavailable++;
        continue;
      }
      const artifact = await persistPaymentArtifact(result);
      try {
        const changed = await db.upload.updateMany({
          where: { id: row.id, paymentArtifact: { equals: Prisma.DbNull } }, data: { paymentArtifact: artifact },
        });
        if (!changed.count) await removePaymentArtifact(artifact);
        else checked++;
      } catch (error) {
        await removePaymentArtifact(artifact);
        throw error;
      }
    }
    cursor = rows[rows.length - 1].id;
  }
  console.log(JSON.stringify({ checked, unavailable }));
}

void main().catch(() => {
  console.error("Payment document conversion stopped");
  process.exitCode = 1;
}).finally(() => db.$disconnect());
