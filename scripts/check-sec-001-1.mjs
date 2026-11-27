import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const keyOf = (label, extension = "png") => `2026/11/${label.repeat(24)}.${extension}`;
const generalFile = (key) => "/api/files/" + key;
const document = (invoice, kind, id) => `/api/billing/documents/${invoice}/${kind}${id ? "/" + id : ""}`;
const student = "student-a";
const teacher = "teacher-a";
const participants = [student, teacher];
const outsiders = ["student-b", "teacher-b", undefined];
const studentPage = "/student/payments?tab=bills";
const teacherPage = "/teacher/finance?tab=check";

async function createFiles(root) {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#246" } }).png().toBuffer();
  await mkdir(path.join(root, "2026/11"), { recursive: true });
  await Promise.all([..."ABCDEFGHKL"].map((label) => writeFile(path.join(root, keyOf(label)), png)));
  const wav = Buffer.alloc(60);
  wav.write("RIFF");
  wav.writeUInt32LE(52, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(16, 40);
  for (const label of "IJ") await writeFile(path.join(root, keyOf(label, "wav")), wav);
  console.log(png.length);
}

function multipart(bytes, type, name = "synthetic") {
  const body = new FormData();
  body.set("file", new File([bytes], name, { type }));
  return body;
}

async function request(url, status, { actor, method = "GET", headers = {}, body } = {}) {
  if (actor) headers.cookie = "vo_session=fixture-" + actor;
  const response = await fetch(process.env.APP_URL + url, { method, headers, body, redirect: "manual" });
  assert.equal(response.status, status, [method, url, actor ?? "guest"].join(" "));
  return response;
}

async function verifyPrivate(url, status, options) {
  const response = await request(url, status, options);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  if (status === 200) {
    assert.match(response.headers.get("content-disposition"), /^attachment;/);
    assert.match(response.headers.get("content-security-policy"), /^sandbox/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  return response;
}

async function getActionIds() {
  const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
  return Object.fromEntries(Object.entries(manifest.node)
    .filter(([, action]) => action.filename === "lib/billing/actions.ts")
    .map(([id, action]) => [action.exportedName, id]));
}

async function action(actor, page, actionId, args, expected) {
  assert.ok(actionId);
  const response = await request(page, 200, {
    actor, method: "POST", body: JSON.stringify(args),
    headers: {
      "next-action": actionId,
      "accept": "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      "origin": process.env.APP_URL,
    },
  });
  assert.match(await response.text(), expected);
}

async function checkEducation(png) {
  const url = generalFile(keyOf("D"));
  assert.match(await (await request("/share/synthetic-share", 200)).text(), /Synthetic homework picture/);
  assert.match(await (await request("/class/fixture-class?tab=homework", 200, { actor: student })).text(), /Synthetic homework picture/);
  for (const file of [url, generalFile(keyOf("I", "wav")), generalFile(keyOf("J", "wav")), "/api/placement/audio/S-A1-05-q3.mp3"]) {
    const range = await request(file, 206, { headers: { range: "bytes=0-7" } });
    assert.equal((await range.arrayBuffer()).byteLength, 8);
  }
  const ordinary = await request("/api/upload", 200, { actor: teacher, method: "POST", body: multipart(png, "image/png") });
  await request((await ordinary.json()).url, 200);
  console.log("Share, assigned homework, Placement audio and ordinary upload passed");
}

async function checkLegacy(db) {
  for (const [kind, id] of [["proof", "legacy-proof"], ["receipt", "legacy-receipt"]]) {
    const url = document("invoice-legacy-good", kind, id);
    for (const actor of participants) {
      assert.ok((await (await verifyPrivate(url, 200, { actor })).arrayBuffer()).byteLength);
      assert.equal((await (await verifyPrivate(url, 200, { actor, method: "HEAD" })).arrayBuffer()).byteLength, 0);
    }
    for (const actor of outsiders) {
      await verifyPrivate(url, 404, { actor });
      await verifyPrivate(url, 404, { actor, method: "HEAD" });
      await verifyPrivate(url, 404, { actor, headers: { range: "bytes=0-7" } });
    }
  }
  for (const label of "ABCEFGKL") {
    const url = generalFile(keyOf(label));
    await verifyPrivate(url, 404);
    await verifyPrivate(url, 404, { actor: teacher, method: "HEAD" });
    assert.ok((await readFile(path.join(process.env.UPLOAD_DIR, keyOf(label)))).length);
  }
  for (const id of ["legacy-foreign", "legacy-alias", "legacy-duplicate", "legacy-detached", "legacy-conflicting-history"]) {
    const old = await db.upload.findUniqueOrThrow({ where: { id } });
    assert.equal(old.paymentKind, "QUARANTINED");
  }
  // The detached payment is identified by the historical snapshot. A reviewed
  // educational use is restored, and an upload with no evidence stays closed.
  await request(generalFile(keyOf("H")), 200);
  await verifyPrivate(document("invoice-current-conflict", "receipt", "legacy-conflicting-history"), 404, { actor: teacher });
  const unresolved = await db.upload.findUniqueOrThrow({ where: { id: "legacy-unresolved" } });
  assert.equal(unresolved.legacyUnverified, true);
  const disconnectedRefs = ["G", "H", "K"].map((label) => generalFile(keyOf(label)));
  assert.equal(await db.invoice.count({ where: { OR: [
    { receiptFile: { in: disconnectedRefs } }, { proofFile: { in: disconnectedRefs } },
  ] } }), 0);
  console.log("Legacy attached documents, quarantined bytes and detached classification fixtures passed");
}

async function upload(invoice, kind, actor, bytes, mime, status = 201) {
  return request(document(invoice, kind), status, { actor, method: "POST", body: multipart(bytes, mime) });
}

async function verify(db) {
  const png = await readFile(path.join(process.env.UPLOAD_DIR, keyOf("D")));
  const actionIds = await getActionIds();
  await checkEducation(png);
  await checkLegacy(db);

  const invoice = "invoice-new";
  await upload(invoice, "proof", undefined, png, "image/png", 401);
  await upload(invoice, "proof", "student-b", png, "image/png", 404);
  await upload(invoice, "proof", teacher, png, "image/png", 404);
  await upload(invoice, "proof", student, Buffer.from("invalid image fixture"), "image/png", 415);
  const doc = await PDFDocument.create();
  doc.addPage().drawText("Synthetic receipt");
  const permittedPdf = Buffer.from(await doc.save());
  await doc.attach(Buffer.from("synthetic attachment"), "sample.txt");
  await upload("invoice-legacy-good", "receipt", teacher, Buffer.from(await doc.save()), "application/pdf", 415);

  const proofId = (await (await upload(invoice, "proof", student, png, "image/png")).json()).id;
  const proofUrl = document(invoice, "proof", proofId);
  const stored = await db.upload.findUniqueOrThrow({ where: { id: proofId } });
  await verifyPrivate(generalFile(stored.path), 404, { actor: student });
  await verifyPrivate(proofUrl, 404, { actor: student });

  const untouched = await db.invoice.findUniqueOrThrow({ where: { id: "invoice-second" } });
  for (const [actor, file] of [["student-b", proofId], [student, proofId], [student, "learning-image"]]) {
    await action(actor, studentPage, actionIds.iPaid, [untouched.id, { file }], /"ok":false/);
  }
  assert.deepEqual(await db.invoice.findUniqueOrThrow({ where: { id: untouched.id } }), untouched);
  assert.equal(await db.aiCall.count({ where: { kind: "ocr" } }), 0);

  await action(student, studentPage, actionIds.iPaid, [invoice, { file: proofId }], /"ok":true,"auto":false/);
  await verifyPrivate(proofUrl, 200, { actor: student });
  await verifyPrivate(proofUrl, 200, { actor: teacher });
  const acceptedProof = await db.invoice.findUniqueOrThrow({ where: { id: invoice } });
  assert.equal(acceptedProof.status, "PROOF_SENT");
  assert.equal(acceptedProof.proofFile, generalFile(stored.path));
  assert.equal(acceptedProof.aiRead.source, "screenshot");
  const ocrCalls = await db.aiCall.count({ where: { kind: "ocr" } });
  assert.equal(ocrCalls, 1);
  await action(student, studentPage, actionIds.iPaid, [untouched.id, { text: "725 руб" }], /"ok":true,"auto":true/);
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: untouched.id } })).status, "PAID");

  const legacyId = "invoice-legacy-good";
  const receiptId = (await (await upload(legacyId, "receipt", teacher, permittedPdf, "application/pdf")).json()).id;
  const oldReceipt = document(legacyId, "receipt", "legacy-receipt");
  const receiptUrl = document(legacyId, "receipt", receiptId);
  await verifyPrivate(receiptUrl, 404, { actor: teacher });
  await action(teacher, teacherPage, actionIds.attachReceipt, [untouched.id, receiptId], /"ok":false/);
  await action("teacher-b", teacherPage, actionIds.attachReceipt, [legacyId, receiptId], /"ok":false/);
  await action(teacher, teacherPage, actionIds.attachReceipt, [legacyId, receiptId], /"ok":true/);
  await verifyPrivate(oldReceipt, 404, { actor: teacher });
  const updated = await verifyPrivate(receiptUrl, 200, { actor: student, headers: { range: "bytes=0-7" } });
  assert.deepEqual(Buffer.from(await updated.arrayBuffer()), permittedPdf);
  await verifyPrivate(receiptUrl, 404);

  const old = await db.invoice.findUniqueOrThrow({ where: { id: "invoice-legacy-unverified" } });
  const restoredId = (await (await upload(old.id, "proof", student, png, "image/png")).json()).id;
  await action(student, studentPage, actionIds.replacePaymentProof, [old.id, restoredId], /"ok":true/);
  const repaired = await db.invoice.findUniqueOrThrow({ where: { id: old.id } });
  assert.notEqual(repaired.proofFile, old.proofFile);
  assert.deepEqual({ ...repaired, proofFile: old.proofFile }, old);
  assert.equal(await db.aiCall.count({ where: { kind: "ocr" } }), ocrCalls);
  await verifyPrivate(document(old.id, "proof", restoredId), 200, { actor: teacher });
  await db.session.delete({ where: { id: "session-student-a" } });
  await verifyPrivate(receiptUrl, 404, { actor: student });
  await verifyPrivate(receiptUrl, 200, { actor: teacher });
  await db.teacherProfile.update({ where: { userId: teacher }, data: { blockedAt: new Date() } });
  await verifyPrivate(receiptUrl, 404, { actor: teacher });
  console.log("Draft, attachment, OCR, format denial, recovery and revocation checks passed");
}

if (process.argv[2] === "create-files") {
  await createFiles(process.argv[3]);
} else if (process.argv[2] === "verify") {
  assert.match(process.env.APP_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(process.env.DATABASE_URL, /^postgresql:\/\/sec_test:sec_test_local@127\.0\.0\.1:\d+\/sec0011_restored$/);
  const db = new PrismaClient();
  try {
    await verify(db);
  } finally {
    await db.$disconnect();
  }
} else {
  throw new Error("Use scripts/check-sec-001-1.sh to provision the test environment");
}
