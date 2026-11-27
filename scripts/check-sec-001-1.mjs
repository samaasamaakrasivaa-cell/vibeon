import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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

async function request(url, status, { actor, method = "GET", headers = {}, body, duplex, origin = process.env.APP_URL } = {}) {
  if (actor) headers.cookie = "vo_session=fixture-" + actor;
  const response = await fetch(origin + url, { method, headers, body, duplex, redirect: "manual" });
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
    .filter(([, action]) => ["lib/billing/actions.ts", "lib/teacher/actions.ts"].includes(action.filename))
    .map(([id, action]) => [action.exportedName, id]));
}

async function action(actor, page, actionId, args, expected, origin = process.env.APP_URL) {
  assert.ok(actionId);
  const response = await request(page, 200, {
    actor, origin, method: "POST", body: JSON.stringify(args),
    headers: {
      "next-action": actionId,
      "accept": "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      "origin": origin,
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

let uploadIp = 1;
async function upload(invoice, kind, actor, bytes, mime, status = 201, origin) {
  return request(document(invoice, kind), status, {
    actor, origin, method: "POST", body: multipart(bytes, mime), headers: { "x-real-ip": "192.0.2." + uploadIp++ },
  });
}

async function checkPackUsage(db, actions) {
  async function paidPack(label, balance = 1) {
    const record = await db.student.create({ data: {
      id: "pack-student-" + label, teacherId: teacher, name: "Synthetic pack " + label, payType: "PACK", status: "ACTIVE", price: 500,
    } });
    const invoice = await db.invoice.create({ data: {
      id: "pack-invoice-" + label, studentId: record.id, kind: "pack", amount: 500,
      packLessons: balance, status: "PAID", paidAt: new Date("2024-02-01T12:00:00Z"),
      proofAt: new Date("2024-02-01T11:45:00Z"), autoAccepted: true,
    } });
    const pack = await db.pack.create({ data: {
      studentId: record.id, invoiceId: invoice.id, price: 500, lessonsLeft: balance, lessonsTotal: balance,
    } });
    return { record, invoice, pack, page: "/teacher/students/" + record.id };
  }

  const unused = await paidPack("unused");
  await action(teacher, teacherPage, actions.undoPaid, [unused.invoice.id], /"ok":true/);
  assert.equal(await db.pack.findUnique({ where: { id: unused.pack.id } }), null);
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: unused.invoice.id } })).status, "PROOF_SENT");

  const used = await paidPack("manual", 2);
  const manualArgs = [used.record.id, "2024-02-05", "12:00"];
  await action("teacher-b", used.page, actions.packDeduct, manualArgs, /"ok":false/);
  await action(teacher, used.page, actions.packDeduct, manualArgs, /"ok":true/);
  await action(teacher, used.page, actions.packDeduct, manualArgs, /"ok":false/);
  const manual = await db.lessonInstance.findMany({ where: { studentId: used.record.id } });
  assert.equal(manual.length, 1);
  assert.equal(manual[0].status, "DONE");
  assert.ok(manual[0].deductedAt);
  const afterCharge = await db.pack.findUniqueOrThrow({ where: { id: used.pack.id } });
  assert.equal(afterCharge.used, true);
  assert.equal(afterCharge.lessonsLeft, 1);
  for (const name of ["undoPaid", "undoAuto", "cancelInvoice"]) {
    await action(teacher, teacherPage, actions[name], [used.invoice.id], /уже списывали занятия/);
  }
  assert.deepEqual(await db.pack.findUniqueOrThrow({ where: { id: used.pack.id } }), afterCharge);
  assert.deepEqual(await db.invoice.findUniqueOrThrow({ where: { id: used.invoice.id } }), used.invoice);
  await action(teacher, used.page, actions.packReturn, [manual[0].id], /"ok":true/);
  const afterReturn = await db.pack.findUniqueOrThrow({ where: { id: used.pack.id } });
  assert.equal(afterReturn.lessonsLeft, 2);
  assert.equal(afterReturn.used, true);
  await action(teacher, teacherPage, actions.undoPaid, [used.invoice.id], /уже списывали занятия/);

  const racing = await paidPack("race");
  await Promise.all([
    action(teacher, racing.page, actions.packDeduct, [racing.record.id, "2024-02-06", "12:00"], /"ok":(?:true|false)/),
    action(teacher, teacherPage, actions.undoPaid, [racing.invoice.id], /"ok":(?:true|false)/),
  ]);
  const racedInvoice = await db.invoice.findUniqueOrThrow({ where: { id: racing.invoice.id } });
  const racedPack = await db.pack.findUnique({ where: { id: racing.pack.id } });
  const racedLessons = await db.lessonInstance.count({ where: { studentId: racing.record.id, deductedAt: { not: null } } });
  if (racedInvoice.status === "PAID") {
    assert.equal(racedPack?.lessonsLeft, 0);
    assert.equal(racedPack?.used, true);
    assert.equal(racedLessons, 1);
  } else {
    assert.equal(racedInvoice.status, "PROOF_SENT");
    assert.equal(racedPack, null);
    assert.equal(racedLessons, 0);
  }

  const mixed = await paidPack("manual-and-auto", 2);
  const lesson = await db.lessonInstance.create({ data: {
    teacherId: teacher, studentId: mixed.record.id, startsAt: new Date("2024-02-07T09:00:00Z"), status: "DONE",
  } });
  const free = await db.lessonInstance.create({ data: {
    teacherId: teacher, studentId: mixed.record.id, startsAt: new Date("2024-02-08T09:00:00Z"), status: "MISSED", charged: false,
  } });
  const charged = await db.lessonInstance.create({ data: {
    teacherId: teacher, studentId: mixed.record.id, startsAt: new Date("2024-02-09T09:00:00Z"), status: "MISSED",
  } });
  await Promise.all([
    action(teacher, mixed.page, actions.packDeduct, [mixed.record.id, "2024-02-07", "12:00"], /"ok":(?:true|false)/),
    request("/api/cron/billing", 200, { method: "POST", headers: { "x-cron-key": "synthetic-sec0011" } }),
  ]);
  const mixedPack = await db.pack.findUniqueOrThrow({ where: { id: mixed.pack.id } });
  assert.equal(mixedPack.lessonsLeft, 0);
  assert.equal(mixedPack.used, true);
  assert.equal(await db.lessonInstance.count({ where: { studentId: mixed.record.id } }), 3);
  const lessons = await db.lessonInstance.findMany({ where: { studentId: mixed.record.id } });
  assert.ok(lessons.find((item) => item.id === lesson.id)?.deductedAt);
  assert.ok(lessons.find((item) => item.id === charged.id)?.deductedAt);
  assert.equal(lessons.find((item) => item.id === free.id)?.deductedAt, null);
  await action(teacher, mixed.page, actions.packDeduct, [mixed.record.id, "2024-02-10", "12:00"], /не осталось занятий/);
  console.log("Unused cancellation, manual deduction, return, races and non-negative pack balances passed");
}

async function checkPostpaidBilling(db, actions) {
  const record = await db.student.create({ data: {
    id: "postpaid-record", teacherId: teacher, name: "Synthetic postpaid", payType: "POSTPAID", status: "ACTIVE", price: 500,
  } });
  const lessons = await Promise.all(["01", "02"].map((day) => db.lessonInstance.create({ data: {
    teacherId: teacher, studentId: record.id, startsAt: new Date(`2024-03-${day}T09:00:00Z`), status: "DONE", price: 500,
  } })));
  await Promise.all([
    action(teacher, "/teacher/students/" + record.id, actions.billNow, [record.id], /"ok":(?:true|false)/),
    action(teacher, "/teacher/students/" + record.id, actions.billNow, [record.id], /"ok":(?:true|false)/),
  ]);
  const issued = await db.invoice.findMany({ where: { studentId: record.id } });
  assert.equal(issued.length, 1);
  assert.equal(issued[0].amount, 1000);
  await Promise.all([
    action(teacher, teacherPage, actions.confirmLessonPaid, [lessons[0].id], /"ok":true/),
    action(teacher, teacherPage, actions.confirmLessonPaid, [lessons[0].id], /"ok":true/),
  ]);
  const paid = await db.invoice.findMany({ where: { studentId: record.id, status: "PAID" } });
  assert.equal(paid.length, 1);
  assert.deepEqual(paid[0].lessonIds, [lessons[0].id]);
  const open = await db.invoice.findUniqueOrThrow({ where: { id: issued[0].id } });
  assert.deepEqual(open.lessonIds, [lessons[1].id]);
  assert.equal(open.amount, 500);
  console.log("Concurrent billing and separate payment of one billed lesson passed");
}

async function checkMultipartLimits(png) {
  const fileLimit = 10 * 1024 * 1024;
  const bodyLimit = fileLimit + 64 * 1024;
  const url = document("invoice-new", "proof");
  // Plain data at the file boundary reaches validation; the next byte does not.
  await upload("invoice-new", "proof", student, Buffer.alloc(fileLimit), "image/png", 415);
  await upload("invoice-new", "proof", student, Buffer.alloc(fileLimit + 1), "image/png", 413);
  const boundary = "synthetic-payment-boundary";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\n`);
  const middle = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="padding"\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  for (const origin of [process.env.APP_URL, process.env.SEC_PROXY_URL]) {
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    for (const [size, status] of [[bodyLimit - 1, 201], [bodyLimit, 201], [bodyLimit + 1, 413]]) {
      const padding = Buffer.alloc(size - head.length - png.length - middle.length - tail.length, 120);
      const body = new ReadableStream({
        start(controller) {
          for (const chunk of [head, png, middle, padding, tail]) controller.enqueue(chunk);
          controller.close();
        },
      });
      await request(url, status, {
        actor: student, origin, method: "POST", body, duplex: "half",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      });
    }
  }
  console.log("File and chunked multipart boundaries passed at Next.js and Caddy");
}

async function checkOcrReplicas(db, actions, png) {
  const fixture = new URL(process.env.PAYMENT_OCR_TEST_URL);
  assert.equal(fixture.hostname, "127.0.0.1");
  async function state() {
    return (await fetch(new URL("/calls", fixture))).json();
  }
  async function setMode(mode) {
    assert.equal((await fetch(new URL("/mode/" + mode, fixture), { method: "POST" })).status, 200);
  }
  async function prepare(id, origin, bytes = png, mime = "image/png") {
    const invoice = await db.invoice.create({ data: { id, studentId: "record-a", kind: "manual", amount: 900, status: "SENT" } });
    const { id: uploadId } = await (await upload(id, "proof", student, bytes, mime, 201, origin)).json();
    return { invoice, uploadId, submit: (target) => action(student, studentPage, actions.iPaid, [id, { file: uploadId }], /"ok":true/, target) };
  }
  const first = await prepare("ocr-first", process.env.APP_URL);
  const second = await prepare("ocr-second", process.env.SEC_REPLICA_URL);
  const before = await state();
  await setMode("hold");
  const processing = first.submit(process.env.APP_URL);
  try {
    for (let i = 0; i < 50 && !(await state()).active; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal((await state()).active, 1);
    await first.submit(process.env.SEC_REPLICA_URL);
    await second.submit(process.env.SEC_REPLICA_URL);
    assert.deepEqual(await state(), { calls: before.calls + 1, active: 1, high: 1 });
    assert.deepEqual((await db.invoice.findUniqueOrThrow({ where: { id: second.invoice.id } })).aiRead,
      { source: "screenshot", matches: false, code: "BUSY" });
  } finally {
    await setMode("empty");
    await processing;
  }
  await first.submit(process.env.SEC_REPLICA_URL);
  assert.equal((await state()).calls, before.calls + 1);

  for (const [mode, code] of [["throttle", "THROTTLED"], ["fail", "FAILED"], ["broken", "BAD_RESPONSE"], ["schema", "BAD_RESPONSE"], ["timeout", "TIMEOUT"]]) {
    await setMode(mode);
    const item = await prepare("ocr-" + mode, process.env.APP_URL);
    const calls = (await state()).calls;
    const started = performance.now();
    await item.submit(process.env.APP_URL);
    if (mode === "timeout") {
      const elapsed = performance.now() - started;
      assert.ok(elapsed >= 14_500 && elapsed < 20_000, String(elapsed));
    }
    await item.submit(process.env.SEC_REPLICA_URL);
    const current = await db.invoice.findUniqueOrThrow({ where: { id: item.invoice.id } });
    assert.equal(current.status, "PROOF_SENT");
    assert.deepEqual(current.aiRead, { source: "screenshot", matches: false, code });
    assert.equal((await state()).calls, calls + 1);
  }
  await setMode("empty");
  const image = await sharp(png).withExif({ IFD0: { Artist: "Synthetic metadata" } }).webp().toBuffer();
  const webp = await prepare("ocr-webp", process.env.APP_URL, image, "image/webp");
  const onePage = await PDFDocument.create();
  onePage.addPage().drawText("Synthetic payment");
  onePage.setTitle("Synthetic metadata");
  const pdf = await prepare("ocr-pdf", process.env.SEC_REPLICA_URL, Buffer.from(await onePage.save()), "application/pdf");
  for (const item of [webp, pdf]) {
    const calls = (await state()).calls;
    await item.submit(process.env.SEC_REPLICA_URL);
    assert.equal((await state()).calls, calls + 1);
    assert.deepEqual((await db.invoice.findUniqueOrThrow({ where: { id: item.invoice.id } })).aiRead,
      { source: "screenshot", matches: false, code: "EMPTY" });
  }
  onePage.addPage();
  const multipage = await prepare("ocr-no-multipage", process.env.APP_URL, Buffer.from(await onePage.save()), "application/pdf");
  const calls = (await state()).calls;
  await multipage.submit(process.env.APP_URL);
  assert.equal((await state()).calls, calls);
  assert.deepEqual((await db.invoice.findUniqueOrThrow({ where: { id: multipage.invoice.id } })).aiRead,
    { source: "screenshot", matches: false, code: "UNSUPPORTED" });
  assert.equal((await state()).high, 1);
  console.log("Two-replica OCR deduplication, concurrency, failures and format boundaries passed");
}

async function verify(db) {
  const png = await readFile(path.join(process.env.UPLOAD_DIR, keyOf("D")));
  const actionIds = await getActionIds();
  await checkEducation(png);
  await checkLegacy(db);
  await checkMultipartLimits(png);
  await verifyPrivate(generalFile(keyOf("A")), 404, { origin: process.env.SEC_PROXY_URL });
  await verifyPrivate(document("invoice-legacy-good", "receipt", "legacy-receipt"), 200, { actor: student, origin: process.env.SEC_PROXY_URL });
  await request("/share/synthetic-share", 200, { origin: process.env.SEC_PROXY_URL });

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
  assert.deepEqual(acceptedProof.aiRead, { source: "screenshot", matches: false, code: "EMPTY" });
  await action(student, studentPage, actionIds.iPaid, [invoice, { file: proofId }], /"ok":true,"auto":false/);
  assert.deepEqual(await db.invoice.findUniqueOrThrow({ where: { id: invoice } }), acceptedProof);
  assert.equal(await db.notification.count({ where: { userId: teacher, kind: "payment" } }), 1);
  const ocrCalls = await db.aiCall.count({ where: { kind: "ocr" } });
  assert.equal(ocrCalls, 1);
  await action(student, studentPage, actionIds.iPaid, [untouched.id, { text: "725 руб" }], /"ok":true,"auto":true/);
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: untouched.id } })).status, "PAID");

  const legacyId = "invoice-legacy-good";
  const staleReceiptId = (await (await upload(legacyId, "receipt", teacher, permittedPdf, "application/pdf")).json()).id;
  const receiptId = (await (await upload(legacyId, "receipt", teacher, permittedPdf, "application/pdf")).json()).id;
  const oldReceipt = document(legacyId, "receipt", "legacy-receipt");
  const receiptUrl = document(legacyId, "receipt", receiptId);
  await verifyPrivate(receiptUrl, 404, { actor: teacher });
  await action(teacher, teacherPage, actionIds.attachReceipt, [untouched.id, receiptId], /"ok":false/);
  await action("teacher-b", teacherPage, actionIds.attachReceipt, [legacyId, receiptId], /"ok":false/);
  const receiptsBefore = await db.notification.count({ where: { userId: student, kind: "receipt" } });
  const beforeRepair = await db.invoice.findUniqueOrThrow({ where: { id: legacyId } });
  await action(teacher, teacherPage, actionIds.attachReceipt, [legacyId, receiptId], /"ok":false/);
  const checkedReceipt = (await db.upload.findUniqueOrThrow({ where: { id: "legacy-receipt" } })).paymentArtifact.document;
  const receiptFile = path.join(process.env.UPLOAD_DIR, checkedReceipt.key);
  await chmod(receiptFile, 0o640);
  await writeFile(receiptFile, Buffer.alloc(checkedReceipt.size));
  for (const method of ["GET", "HEAD"]) await verifyPrivate(oldReceipt, 404, { actor: teacher, method });
  await action(teacher, teacherPage, actionIds.attachReceipt, [legacyId, receiptId], /"ok":true/);
  await action(teacher, teacherPage, actionIds.attachReceipt, [legacyId, receiptId], /"ok":true/);
  await action(teacher, teacherPage, actionIds.attachReceipt, [legacyId, staleReceiptId], /"ok":false/);
  assert.equal(await db.notification.count({ where: { userId: student, kind: "receipt" } }), receiptsBefore);
  const afterRepair = await db.invoice.findUniqueOrThrow({ where: { id: legacyId } });
  assert.deepEqual({ ...afterRepair, receiptFile: beforeRepair.receiptFile, revision: beforeRepair.revision }, beforeRepair);
  const receiptVersion = await db.invoiceDocumentVersion.findUniqueOrThrow({ where: { uploadId: receiptId } });
  assert.equal(receiptVersion.previous, beforeRepair.receiptFile);
  assert.equal(receiptVersion.actorId, teacher);
  assert.equal(receiptVersion.restored, true);
  await verifyPrivate(oldReceipt, 404, { actor: teacher });
  const updated = await verifyPrivate(receiptUrl, 200, { actor: student, headers: { range: "bytes=0-7" } });
  assert.deepEqual(Buffer.from(await updated.arrayBuffer()), permittedPdf);
  await verifyPrivate(receiptUrl, 404);

  const old = await db.invoice.update({ where: { id: "invoice-legacy-unverified" }, data: {
    status: "CANCELLED", title: "Archived synthetic invoice",
  } });
  for (const [actor, page] of [[teacher, teacherPage], [student, studentPage]]) {
    assert.match(await (await request(page, 200, { actor })).text(), /Archived synthetic invoice/);
  }
  for (const [actor, page] of [["teacher-b", teacherPage], ["student-b", studentPage]]) {
    assert.doesNotMatch(await (await request(page, 200, { actor })).text(), /Archived synthetic invoice/);
  }
  const restoredId = (await (await upload(old.id, "proof", student, png, "image/png")).json()).id;
  await action("student-b", studentPage, actionIds.replacePaymentProof, [old.id, restoredId], /"ok":false/);
  await Promise.all([process.env.APP_URL, process.env.SEC_REPLICA_URL].map((origin) =>
    action(student, studentPage, actionIds.replacePaymentProof, [old.id, restoredId], /"ok":true/, origin)));
  const proofVersion = await db.invoiceDocumentVersion.findUniqueOrThrow({ where: { uploadId: restoredId } });
  assert.equal(proofVersion.previous, old.proofFile);
  assert.equal(proofVersion.actorId, student);
  assert.equal(proofVersion.restored, true);
  const repaired = await db.invoice.findUniqueOrThrow({ where: { id: old.id } });
  assert.notEqual(repaired.proofFile, old.proofFile);
  assert.equal(repaired.revision, old.revision + 1);
  assert.deepEqual({ ...repaired, proofFile: old.proofFile, revision: old.revision }, old);
  assert.equal(await db.aiCall.count({ where: { kind: "ocr" } }), ocrCalls);
  await verifyPrivate(document(old.id, "proof", restoredId), 200, { actor: teacher });
  const unwantedReplacement = (await (await upload(old.id, "proof", student, png, "image/png")).json()).id;
  await action(student, studentPage, actionIds.replacePaymentProof, [old.id, unwantedReplacement], /"ok":false/);
  await checkOcrReplicas(db, actionIds, png);
  await checkPackUsage(db, actionIds);
  await checkPostpaidBilling(db, actionIds);
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
