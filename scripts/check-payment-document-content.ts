// Run with node --conditions=react-server --import tsx scripts/check-payment-document-content.ts
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { inspectPaymentDocument } from "../src/lib/billing/document-content";

async function main() {
  for (const [format, mime] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]] as const) {
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#246" } }).toFormat(format).toBuffer();
    const safe = await inspectPaymentDocument(input, mime);
    assert.equal(safe?.mime, mime);
    assert.equal((await sharp(safe!.buf).metadata()).format, format);
    assert.equal(await inspectPaymentDocument(input, "image/svg+xml"), null);
    assert.equal(await inspectPaymentDocument(input.subarray(0, 12), mime), null);
  }

  const doc = await PDFDocument.create();
  doc.addPage().drawText("Synthetic payment document");
  const pdf = Buffer.from(await doc.save());
  assert.deepEqual(await inspectPaymentDocument(pdf, "application/pdf"), { buf: pdf, mime: "application/pdf" });

  await doc.attach(Buffer.from("synthetic attachment"), "attachment.txt", { mimeType: "text/plain" });
  const withAttachment = Buffer.from(await doc.save());
  assert.equal(await inspectPaymentDocument(withAttachment, "application/pdf"), null);

  const form = await PDFDocument.create();
  form.getForm().createTextField("synthetic").addToPage(form.addPage());
  assert.equal(await inspectPaymentDocument(Buffer.from(await form.save()), "application/pdf"), null);
  assert.equal(await inspectPaymentDocument(Buffer.from("%PDF-1.7\n%%EOF\n"), "application/pdf"), null);
  assert.equal(await inspectPaymentDocument(Buffer.from("<svg/>"), "image/png"), null);
  console.log("Payment document content checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
