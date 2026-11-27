import assert from "node:assert/strict";
import http from "node:http";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { inspectPaymentDocument } from "../src/lib/billing/document-content";

async function checkWorkerDeadline() {
  const started = performance.now();
  let pending: http.ClientRequest;
  const status = new Promise((resolve, reject) => {
    pending = http.request({
      socketPath: process.env.PAYMENT_VALIDATOR_SOCKET, path: "/validate", method: "POST",
      headers: { "Content-Type": "image/png", "Content-Length": 2 },
    }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    pending.on("error", reject);
    pending.write(Buffer.from([0]));
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(await inspectPaymentDocument(Buffer.from([0]), "image/png"), { error: "busy" });
    assert.equal(await status, 504);
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 4_800 && elapsed < 6_500, String(elapsed));
    assert.deepEqual(await inspectPaymentDocument(Buffer.from([0]), "image/png"), { error: "type" });
    console.log(`Worker deadline, rejection while occupied and release passed (${Math.round(elapsed)} ms)`);
  } finally {
    pending!.destroy();
  }
}

async function main() {
  for (const [format, mime] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]] as const) {
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#246" } }).toFormat(format).toBuffer();
    const safe = await inspectPaymentDocument(input, mime);
    assert.ok(!("error" in safe), JSON.stringify(safe));
    assert.equal(safe.mime, mime);
    assert.equal((await sharp(safe.buf).metadata()).format, format);
    assert.equal(safe.ocr?.mime, format === "webp" ? "image/jpeg" : mime);
    assert.deepEqual(await inspectPaymentDocument(input, "image/svg+xml"), { error: "type" });
    assert.deepEqual(await inspectPaymentDocument(input.subarray(0, 12), mime), { error: "type" });
  }

  for (const height of [2999, 3000, 3001]) {
    const image = await sharp({ create: { width: 4000, height, channels: 3, background: "#246" } }).png().toBuffer();
    const checked = await inspectPaymentDocument(image, "image/png");
    if (height > 3000) assert.deepEqual(checked, { error: "pixels" });
    else assert.ok(!("error" in checked), JSON.stringify(checked));
  }

  const doc = await PDFDocument.create();
  doc.addPage().drawText("Synthetic payment document");
  const pdf = Buffer.from(await doc.save());
  const checked = await inspectPaymentDocument(pdf, "application/pdf");
  assert.ok(!("error" in checked), JSON.stringify(checked));
  assert.deepEqual(checked.buf, pdf);
  assert.equal(checked.pages, 1);
  assert.ok(checked.ocr);
  assert.equal((await PDFDocument.load(checked.ocr.buf)).getPageCount(), 1);
  await doc.attach(Buffer.from("synthetic attachment"), "attachment.txt", { mimeType: "text/plain" });
  assert.deepEqual(await inspectPaymentDocument(Buffer.from(await doc.save()), "application/pdf"), { error: "type" });

  const form = await PDFDocument.create();
  form.getForm().createTextField("synthetic").addToPage(form.addPage());
  assert.deepEqual(await inspectPaymentDocument(Buffer.from(await form.save()), "application/pdf"), { error: "type" });
  assert.deepEqual(await inspectPaymentDocument(Buffer.from("%PDF-1.7\n%%EOF\n"), "application/pdf"), { error: "type" });

  const pages = await PDFDocument.create();
  for (let i = 1; i <= 21; i++) {
    pages.addPage();
    if (![2, 19, 20, 21].includes(i)) continue;
    const result = await inspectPaymentDocument(Buffer.from(await pages.save()), "application/pdf");
    if (i > 20) assert.deepEqual(result, { error: "pages" });
    else {
      assert.ok(!("error" in result), JSON.stringify(result));
      assert.equal(result.pages, i);
      assert.equal(result.ocr, undefined);
    }
  }

  const hugeRaster = await PDFDocument.create();
  hugeRaster.addPage();
  hugeRaster.context.register(hugeRaster.context.stream(Buffer.alloc(1), {
    Type: "XObject", Subtype: "Image", Width: 4000, Height: 3001,
  }));
  assert.deepEqual(await inspectPaymentDocument(Buffer.from(await hugeRaster.save()), "application/pdf"), { error: "pixels" });

  const expandedLimit = 64 * 1024 ** 2;
  for (const bytes of [expandedLimit - 1, expandedLimit, expandedLimit + 1]) {
    const doc = await PDFDocument.create();
    doc.addPage();
    // Spread the budget over two streams so a per-stream cap cannot pass.
    for (const length of [expandedLimit / 2, bytes - expandedLimit / 2]) {
      const compressed = deflateSync(Buffer.alloc(length));
      doc.context.register(doc.context.stream(compressed, { Filter: "FlateDecode" }));
    }
    const result = await inspectPaymentDocument(Buffer.from(await doc.save({ useObjectStreams: false })), "application/pdf");
    if (bytes > expandedLimit) assert.deepEqual(result, { error: "expanded" });
    else assert.ok(!("error" in result), JSON.stringify(result));
  }
  await checkWorkerDeadline();
  console.log("PDF page and aggregate inflation boundaries, image pixel boundaries and active content rejection passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
