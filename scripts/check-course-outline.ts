import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "../src/lib/db";
import { courseOutlineSchema } from "../src/lib/tasks/course-outline";
import { issueCourseOutlineDraft } from "../src/lib/teacher/course-outline-draft";
import { appendCourseUnit, orderCourseUnits, saveCourseOutlineUnits, withCourseUnits } from "../src/lib/teacher/course-units";

function draft(teacherId: string, courseId: string, now?: number) {
  const ticket = issueCourseOutlineDraft(teacherId, courseId, now);
  assert.ok(ticket);
  return ticket;
}

async function waitForCourseWriters(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [waiting] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
        AND query LIKE '%FROM "Course"%FOR NO KEY UPDATE%'
    `;
    if (Number(waiting.count) >= count) return;
    await delay(40);
  }
  assert.fail(`Expected ${count} writers waiting on the PostgreSQL course lock`);
}

async function main() {
  process.env.AUTH_SECRET = randomBytes(32).toString("hex");
  const run = randomUUID();
  const courseIds: string[] = [];
  const teacherIds: string[] = [];
  const plan = courseOutlineSchema.parse({
    units: [
      { title: "Imported A", lessons: [{ title: "Edited lesson", grammar: "Present simple" }] },
      { title: "Imported B" },
    ],
  });

  const createTeacher = async (suffix: string) => {
    const teacher = await db.user.create({
      data: { name: "Synthetic course teacher", email: `${run}-${suffix}@example.invalid`, role: "TEACHER", teacherProfile: { create: {} } },
    });
    teacherIds.push(teacher.id);
    return teacher.id;
  };
  const createCourse = async (teacherId: string, title: string) => {
    const course = await db.course.create({ data: { teacherId, title } });
    courseIds.push(course.id);
    return course.id;
  };

  try {
    const teacher = await createTeacher("owner");
    const otherTeacher = await createTeacher("other");
    const course = await createCourse(teacher, "Course outline regression");
    const secondCourse = await createCourse(teacher, "Another course owned by the same teacher");
    const transferredCourse = await createCourse(teacher, "Synthetic ownership change");
    const ticket = draft(teacher, course);
    const transferredTicket = draft(teacher, transferredCourse);
    await db.course.update({ where: { id: transferredCourse }, data: { teacherId: otherTeacher } });
    const tampered = ticket.slice(0, -1) + (ticket.endsWith("A") ? "B" : "A");

    assert.equal(await saveCourseOutlineUnits(secondCourse, teacher, ticket, plan), "invalid-draft");
    assert.equal(await saveCourseOutlineUnits(transferredCourse, otherTeacher, transferredTicket, plan), "invalid-draft");
    assert.equal(await saveCourseOutlineUnits(transferredCourse, teacher, transferredTicket, plan), null);
    assert.equal(await saveCourseOutlineUnits(course, teacher, draft(teacher, course, Date.now() - 3_600_000), plan), "invalid-draft");
    assert.equal(await saveCourseOutlineUnits(course, teacher, tampered, plan), "invalid-draft");
    assert.equal(await saveCourseOutlineUnits(course, teacher, randomUUID(), plan), "invalid-draft");
    assert.equal(await db.unit.count({ where: { courseId: { in: courseIds } } }), 0);

    await db.unit.create({ data: { courseId: secondCourse, title: "Unit after a gap", order: 5 } });
    assert.equal((await appendCourseUnit(secondCourse, teacher, ""))?.order, 6);

    const first = await db.unit.create({ data: { courseId: course, title: "First old unit", order: 0 } });
    const second = await db.unit.create({ data: { courseId: course, title: "Old unit after a gap", order: 5 } });
    const locked = Promise.withResolvers<void>();
    const unlock = Promise.withResolvers<void>();
    const holding = withCourseUnits(course, teacher, async () => {
      locked.resolve();
      await unlock.promise;
    });
    await Promise.race([locked.promise, holding]);
    const writes: Promise<unknown>[] = [];
    try {
      writes.push(saveCourseOutlineUnits(course, teacher, ticket, plan));
      await waitForCourseWriters(1);
      writes.push(appendCourseUnit(course, teacher, "Manual unit"));
      await waitForCourseWriters(2);
      writes.push(orderCourseUnits(course, teacher, [second.id, first.id]));
      await waitForCourseWriters(3);
    } finally {
      unlock.resolve();
      await Promise.allSettled([holding, ...writes]);
    }
    const [saved, manual, reordered] = await Promise.all(writes);
    assert.equal(saved, "saved");
    assert.ok(manual && typeof manual === "object" && "title" in manual && manual.title === "Manual unit");
    assert.equal(reordered, true);

    const units = await db.unit.findMany({
      where: { courseId: course },
      orderBy: { order: "asc" },
      include: { lessons: true },
    });
    assert.equal(units.length, 5);
    assert.deepEqual(units.map((unit) => unit.order), [0, 1, 2, 3, 4]);
    assert.deepEqual(units.slice(0, 2).map((unit) => unit.id), [second.id, first.id]);
    const importIndex = units.findIndex((unit) => unit.title === "Imported A");
    assert.equal(units[importIndex + 1].title, "Imported B");
    assert.deepEqual(units[importIndex].outcomes, ["Grammar — Present simple"]);
    assert.equal(units[importIndex].lessons[0].title, "Edited lesson");

    const retry = courseOutlineSchema.parse({ units: [{ title: "Replayed with different edits" }] });
    assert.deepEqual(await Promise.all([
      saveCourseOutlineUnits(course, teacher, ticket, plan),
      saveCourseOutlineUnits(course, teacher, ticket, retry),
    ]), ["saved", "saved"]);
    assert.deepEqual(await db.unit.findMany({ where: { courseId: course }, orderBy: { order: "asc" }, select: { id: true } }),
      units.map(({ id }) => ({ id })));
    await withCourseUnits(course, teacher, (tx) => tx.unit.deleteMany({
      where: { courseId: course, id: { in: [units[importIndex].id, units[importIndex + 1].id] } },
    }));
    assert.equal(await saveCourseOutlineUnits(course, teacher, ticket, plan), "saved");
    assert.equal(await db.unit.count({ where: { courseId: course } }), 3);
    console.log("Course outline: draft ownership, expiry, replay, and concurrent import, append, and reorder passed");
  } finally {
    await db.course.deleteMany({ where: { id: { in: courseIds } } });
    await db.user.deleteMany({ where: { id: { in: teacherIds } } });
    await db.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
