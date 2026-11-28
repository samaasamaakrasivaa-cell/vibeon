import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

assert.match(process.env.DATABASE_URL ?? "", /^postgresql:\/\/issue4_fixture:issue4_local@127\.0\.0\.1:\d+\/issue4$/);
assert.match(process.env.APP_URL ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const db = new PrismaClient();
const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const actions = Object.fromEntries(Object.entries(manifest.node)
  .filter(([, item]) => ["lib/billing/actions.ts", "lib/teacher/actions.ts"].includes(item.filename))
  .map(([key, item]) => [item.exportedName, key]));

async function action(name, args, { actor = "teacher", page = "/teacher/finance?tab=check", status = 200 } = {}) {
  assert.ok(actions[name], name);
  const res = await fetch(process.env.APP_URL + page, {
    method: "POST", redirect: "manual", body: JSON.stringify(args),
    headers: { cookie: "vo_session=fixture-" + actor, origin: process.env.APP_URL,
      "next-action": actions[name], accept: "text/x-component", "content-type": "text/plain;charset=UTF-8" },
  });
  assert.equal(res.status, status, name);
  const text = await res.text();
  if (status === 200) assert.match(text, /"ok":(?:true|false)/, name);
  return text.includes('"ok":true');
}
const record = (id) => db.student.create({ data: { id, teacherId: "teacher", name: "Synthetic " + id, payType: "PACK", status: "ACTIVE", price: 500 } });
const pack = (s, count, invoiceId) => db.pack.create({ data: { studentId: s.id, lessonsTotal: count, lessonsLeft: count, price: 500, invoiceId } });
const lesson = (s, day, hour, change = {}) => db.lessonInstance.create({ data: {
  teacherId: "teacher", studentId: s.id, status: "DONE", price: 500, startsAt: new Date(`2024-02-${day}T${hour}:00:00Z`), ...change,
} });
const invoice = (s, kind, change = {}) => db.invoice.create({ data: { studentId: s.id, kind, amount: 500, status: "SENT", ...change } });
const balance = (p) => db.pack.findUniqueOrThrow({ where: { id: p.id } });
const current = (l) => db.lessonInstance.findUniqueOrThrow({ where: { id: l.id } });
const page = (s) => "/teacher/students/" + s.id;

async function runCron() {
  const response = await fetch(process.env.APP_URL + "/api/cron/billing", { method: "POST", headers: { "x-cron-key": "synthetic-issue4" } });
  assert.equal(response.status, 200);
}

async function verify() {
  const historical = await db.pack.findMany({ where: { studentId: "history" }, orderBy: { id: "asc" }, select: { id: true, used: true, lessonsLeft: true, price: true } });
  assert.deepEqual(historical, [
    { id: "history-spent", used: true, lessonsLeft: 1, price: 500 },
    { id: "history-untouched", used: false, lessonsLeft: 2, price: 500 },
  ]);

  const exact = await record("exact");
  const exactPack = await pack(exact, 2);
  const morning = await lesson(exact, "02", "06");
  const afternoon = await lesson(exact, "02", "14");
  assert.equal(await action("packDeduct", [exact.id, "2024-02-02", "17:00"], { page: page(exact), actor: "other-teacher" }), false);
  assert.equal(await action("packDeduct", [exact.id, "2024-02-02", ""], { page: page(exact) }), false);
  assert.equal(await action("packDeduct", [exact.id, "2024-02-02", "16:00"], { page: page(exact) }), false);
  assert.equal((await balance(exactPack)).lessonsLeft, 2);
  assert.equal(await action("packDeduct", [exact.id, "2024-02-02", "17:00"], { page: page(exact) }), true);
  assert.equal(await action("packDeduct", [exact.id, "2024-02-02", "17:00"], { page: page(exact) }), false);
  assert.equal(await action("packDeduct", [exact.id, "2024-02-02", ""], { page: page(exact) }), false);
  assert.equal((await current(morning)).deductedAt, null);
  assert.ok((await current(afternoon)).deductedAt);
  assert.equal((await balance(exactPack)).lessonsLeft, 1);
  assert.equal(await action("packDeduct", [exact.id, "2024-02-03", "12:00"], { page: page(exact) }), true);
  assert.equal(await db.lessonInstance.count({ where: { studentId: exact.id } }), 3);
  assert.equal((await balance(exactPack)).lessonsLeft, 0);
  console.log("Migration, explicit lesson selection, retries, foreign teacher and lesson outside the platform passed");

  const race = await record("race");
  const last = await pack(race, 1);
  await lesson(race, "04", "06");
  await lesson(race, "04", "14");
  const manual = await Promise.all(["09:00", "17:00"].map((time) => action("packDeduct", [race.id, "2024-02-04", time], { page: page(race) })));
  assert.deepEqual(manual.sort(), [false, true]);
  assert.equal((await balance(last)).lessonsLeft, 0);
  assert.equal(await db.lessonInstance.count({ where: { studentId: race.id, deductedAt: { not: null } } }), 1);

  const planned = await record("planner");
  const plannedPack = await pack(planned, 2);
  const joint = await lesson(planned, "05", "06");
  const missed = await lesson(planned, "06", "06", { status: "MISSED" });
  const free = await lesson(planned, "07", "06", { status: "MISSED", charged: false });
  await Promise.all([runCron(), action("packDeduct", [planned.id, "2024-02-05", "09:00"], { page: page(planned) })]);
  assert.equal((await balance(plannedPack)).lessonsLeft, 0);
  assert.ok((await current(joint)).deductedAt);
  assert.ok((await current(missed)).deductedAt);
  assert.equal((await current(free)).deductedAt, null);
  console.log("Two manual requests and scheduler versus manual use passed");

  const debt = await record("debt");
  const due = await invoice(debt, "pack", { packLessons: 2, status: "PROOF_SENT" });
  const older = await lesson(debt, "08", "06");
  const next = await lesson(debt, "09", "06");
  const billed = await lesson(debt, "07", "06", { billedAt: new Date("2024-02-07") });
  assert.equal(await action("markPaid", [due.id]), true);
  const paidPack = await db.pack.findUniqueOrThrow({ where: { invoiceId: due.id } });
  assert.equal(paidPack.lessonsLeft, 0);
  assert.equal(paidPack.used, true);
  assert.ok((await current(older)).deductedAt);
  assert.ok((await current(next)).deductedAt);
  assert.equal((await current(billed)).deductedAt, null);
  for (const op of ["undoPaid", "undoAuto", "cancelInvoice"]) assert.equal(await action(op, [due.id]), false);
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: due.id } })).status, "PAID");

  const local = await record("return");
  const consumedInvoice = await invoice(local, "pack", { packLessons: 1, status: "PAID" });
  const consumed = await pack(local, 1, consumedInvoice.id);
  const returned = await lesson(local, "10", "06");
  assert.equal(await action("packDeduct", [local.id, "2024-02-10", "09:00"], { page: page(local) }), true);
  assert.equal(await action("packReturn", [returned.id], { page: page(local) }), true);
  assert.equal((await balance(consumed)).lessonsLeft, 1);
  assert.equal((await balance(consumed)).used, true);
  assert.equal(await action("undoPaid", [consumedInvoice.id]), false);
  const unusedInvoice = await invoice(local, "pack", { packLessons: 1, status: "PAID" });
  await pack(local, 1, unusedInvoice.id);
  assert.equal(await action("undoPaid", [unusedInvoice.id]), true);
  assert.equal(await db.pack.findUnique({ where: { invoiceId: unusedInvoice.id } }), null);
  console.log("Debt repayment and used/unused cancellation, including after a return, passed");

  const separate = await record("separate");
  const preserved = await pack(separate, 2);
  const paidLesson = await lesson(separate, "11", "06");
  assert.equal(await action("confirmLessonPaid", [paidLesson.id], { actor: "other-teacher" }), false);
  assert.equal(await action("confirmLessonPaid", [paidLesson.id]), true);
  assert.equal(await action("confirmLessonPaid", [paidLesson.id]), true);
  assert.equal(await action("packDeduct", [separate.id, "2024-02-11", "09:00"], { page: page(separate) }), false);
  assert.equal((await balance(preserved)).lessonsLeft, 2);
  assert.equal((await balance(preserved)).used, false);
  assert.equal(await db.invoice.count({ where: { lessonIds: { has: paidLesson.id }, status: "PAID" } }), 1);

  const raced = await lesson(separate, "12", "06");
  const [deducted, paid] = await Promise.all([
    action("packDeduct", [separate.id, "2024-02-12", "09:00"], { page: page(separate) }),
    action("confirmLessonPaid", [raced.id]),
  ]);
  assert.notEqual(deducted, paid);
  assert.equal((await balance(preserved)).lessonsLeft, deducted ? 1 : 2);
  assert.equal(await db.invoice.count({ where: { lessonIds: { has: raced.id }, status: "PAID" } }), paid ? 1 : 0);
  const billedRace = await record("bill-race");
  const billedPack = await pack(billedRace, 1);
  const billingTarget = await lesson(billedRace, "15", "06");
  const [spent, issued] = await Promise.all([
    action("packDeduct", [billedRace.id, "2024-02-15", "09:00"], { page: page(billedRace) }),
    action("billNow", [billedRace.id], { page: page(billedRace) }),
  ]);
  assert.notEqual(spent, issued);
  assert.equal((await balance(billedPack)).lessonsLeft, spent ? 0 : 1);
  assert.equal(await db.invoice.count({ where: { lessonIds: { has: billingTarget.id } } }), issued ? 1 : 0);
  console.log("Separate lesson payment, retry and invoice issuance versus pack use passed");

  const rollback = await record("rollback");
  const intact = await pack(rollback, 1);
  await db.$executeRawUnsafe(`
    CREATE FUNCTION issue4_reject_spend() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."studentId" IN ('rollback', 'debt-rollback') AND NEW."lessonsLeft" < OLD."lessonsLeft" THEN
        RAISE EXCEPTION 'synthetic failed pack update';
      END IF;
      RETURN NEW;
    END $$
  `);
  await db.$executeRawUnsafe('CREATE TRIGGER issue4_reject_spend BEFORE UPDATE ON "Pack" FOR EACH ROW EXECUTE FUNCTION issue4_reject_spend()');
  await action("packDeduct", [rollback.id, "2024-02-13", "09:00"], { page: page(rollback), status: 500 });
  assert.equal((await balance(intact)).lessonsLeft, 1);
  assert.equal((await balance(intact)).used, false);
  assert.equal(await db.lessonInstance.count({ where: { studentId: rollback.id } }), 0);
  const debtRollback = await record("debt-rollback");
  const original = await invoice(debtRollback, "pack", { packLessons: 1, status: "PROOF_SENT" });
  const owed = await lesson(debtRollback, "14", "06");
  await action("markPaid", [original.id], { status: 500 });
  assert.deepEqual(await db.invoice.findUniqueOrThrow({ where: { id: original.id } }), original);
  assert.equal(await db.pack.findUnique({ where: { invoiceId: original.id } }), null);
  assert.equal((await current(owed)).deductedAt, null);
  console.log("Injected pack-write failure rolled back the new lesson and the entire debt-payment transaction");
}

try {
  await verify();
} finally {
  await db.$disconnect();
}
