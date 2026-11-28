import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { homeworkFor, homeworkWaitingForReview } from "../src/lib/homework";
import { reviewCounts } from "../src/lib/review-counts";

const database = new URL(process.env.DATABASE_URL ?? "");
const app = new URL(process.env.HW_TEST_APP_URL ?? "");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/vibeon_hw24_test");
assert.equal(app.hostname, "127.0.0.1");
assert.equal(app.protocol, "http:");

const run = randomUUID();
const sessionIds: string[] = [];
async function account(role: "TEACHER" | "STUDENT", name: string) {
  const token = randomUUID();
  const user = await db.user.create({ data: {
    role, name, email: `${token}@example.test`,
    ...(role === "TEACHER" ? { teacherProfile: { create: {} } } : {}),
    sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } },
  } });
  sessionIds.push(user.id);
  return { id: user.id, cookie: `vo_session=${token}` };
}

const request = (path: string, cookie: string, body?: object) => fetch(new URL(path, app), {
  headers: { cookie, "Content-Type": "application/json" },
  ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), redirect: "manual", signal: AbortSignal.timeout(60_000),
});

async function ok(response: Response) {
  assert.equal(response.status, 200, `${response.url} ${response.status} ${response.ok ? "" : await response.text()}`);
  return response.json();
}

async function runTest() {
  const teacher = await account("TEACHER", "Homework test teacher");
  const outsider = await account("TEACHER", "Unrelated teacher");
  const group = await db.group.create({ data: { teacherId: teacher.id, title: "Homework test group" } });
  const course = await db.course.create({ data: { teacherId: teacher.id, title: "Synthetic course" } });
  const unit = await db.unit.create({ data: { courseId: course.id, title: "Synthetic unit", outcomes: [] } });
  const template = await db.lessonTemplate.create({ data: { unitId: unit.id, title: "Synthetic lesson", outcomes: [] } });
  const tasks = await Promise.all(["translate", "transform"].map((type) => db.task.create({ data: {
    templateId: template.id, section: "homework", type, title: type, content: "First prompt\nSecond prompt",
  } })));

  async function student(label: string, task: (typeof tasks)[number]) {
    const name = `Synthetic revision ${label} ${run.slice(0, 8)}`;
    const user = await account("STUDENT", name);
    const pupil = await db.student.create({ data: { userId: user.id, teacherId: teacher.id, name, status: "ACTIVE" } });
    const original = { val: { 0: `original-${label}-${run}`, 1: `original second ${label}` }, corr: { 0: `private-${label}-${run}` } };
    const comment = `returned-${label}-${run}`;
    const lesson = await db.lessonInstance.create({ data: {
      teacherId: teacher.id, studentId: pupil.id, groupId: group.id, slotId: run, templateId: template.id,
      startsAt: new Date(Date.now() - 7_200_000), status: "DONE", finishedAt: new Date(Date.now() - 3_600_000),
      homework: { create: { taskIds: [], extraTaskIds: [task.id], wordTraining: [] } },
    } });
    const answer = await db.answer.create({ data: { lessonInstanceId: lesson.id, studentId: pupil.id, taskId: task.id, payload: original, status: "NEEDS_REVIEW" } });
    const base = `/api/class/${lesson.id}`;
    return { name, user, pupil, task, lesson, answer, original, comment, base, path: `${base}/homework/${task.id}` };
  }

  const a = await student("A", tasks[0]);
  const b = await student("B", tasks[1]);
  await db.answer.create({ data: {
    lessonInstanceId: a.lesson.id, studentId: a.pupil.id, taskId: b.task.id,
    payload: { val: { 0: "Unassigned answer" } }, status: "REVIEWED", teacherReview: { ok: false },
  } });
  await db.lessonInstance.create({ data: {
    teacherId: teacher.id, studentId: a.pupil.id, templateId: template.id,
    startsAt: new Date(Date.now() - 1_800_000), finishedAt: new Date(Date.now() - 900_000), status: "DONE",
    homework: { create: { taskIds: [], extraTaskIds: [tasks[0].id], wordTraining: [] } },
  } });
  const page = (pupil: typeof a, cookie = pupil.user.cookie) => request(`/class/${pupil.lesson.id}?tab=homework`, cookie);
  const teacherReview = (pupil: typeof a, comment: string, approved = false) => request(`${pupil.base}/act`, teacher.cookie, {
    type: "review", taskId: pupil.task.id, studentId: pupil.pupil.id, ok: approved, comment,
  });
  const change = (pupil: typeof a, type: string, revision: number, payload?: object) => request(pupil.path, pupil.user.cookie, { type, revision, payload });
  const read = (pupil: typeof a) => db.answer.findUniqueOrThrow({ where: { id: pupil.answer.id } });
  async function queue(expected: (typeof a)[]) {
    const items = homeworkWaitingForReview(await homeworkFor({ teacherId: teacher.id }));
    assert.deepEqual(items.map((item) => item.lesson.id).sort(), expected.map((pupil) => pupil.lesson.id).sort());
    assert.equal((await reviewCounts(teacher.id)).hw, expected.length);
    const response = await request("/teacher/homework?kind=hw&tab=review", teacher.cookie);
    assert.equal(response.status, 200);
    const html = await response.text();
    for (const pupil of [a, b]) assert.equal(html.includes(pupil.name), expected.includes(pupil));
  }

  await queue([]);
  const groupStream = await request(`${b.base}/events`, b.user.cookie);
  assert.equal(groupStream.status, 200);
  const reader = groupStream.body!.getReader();
  try {
    for (const pupil of [a, b]) await ok(await teacherReview(pupil, pupil.comment));
    const returnedPage = await page(a);
    assert.equal(returnedPage.status, 200);
    assert.match(await returnedPage.text(), /Начать доработку/);
    assert.equal((await request(a.path, b.user.cookie)).status, 403);
    assert.equal((await request(a.path, outsider.cookie)).status, 403);
    assert.equal((await request(a.path, teacher.cookie, { type: "start", revision: 1 })).status, 403);
    assert.equal((await request(`/api/class/${a.lesson.id}/homework/${b.task.id}`, a.user.cookie)).status, 404);
    const originalVersion = (await read(a)).homeworkRevision;
    const startRace = await Promise.all([change(a, "start", originalVersion), change(a, "start", originalVersion)]);
    assert.deepEqual(startRace.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(await db.homeworkAttempt.count({ where: { answerId: a.answer.id } }), 1);
    const unchanged = await read(b);
    assert.equal(unchanged.previousHomeworkAttemptId, null);
    assert.deepEqual(unchanged.payload, b.original);
    await ok(await change(b, "start", (await read(b)).homeworkRevision));
    const partialB = await ok(await change(b, "save", (await read(b)).homeworkRevision, { val: { 0: "Partial", 1: "  " } }));
    assert.equal((await change(b, "submit", partialB.revision)).status, 422);

    const archivedForA = (await ok(await request(a.path, a.user.cookie))).archived;
    assert.equal(archivedForA.length, 1);
    assert.deepEqual(archivedForA[0].payload, { val: a.original.val });
    assert.equal(archivedForA[0].review.comment, a.comment);
    const archivedForTeacher = (await ok(await request(a.path, teacher.cookie))).archived;
    assert.deepEqual(archivedForTeacher[0].payload, a.original);
    const bPage = await page(b);
    assert.equal(bPage.status, 200);
    assert.ok(!(await bPage.text()).includes(a.comment));

    const partial = await ok(await change(a, "save", (await read(a)).homeworkRevision, { val: { 0: "Partial" } }));
    assert.equal((await change(a, "save", partial.revision, { val: { 0: 17 } })).status, 400);
    assert.equal((await change(a, "save", partial.revision - 1, { val: { 0: "Stale draft" } })).status, 409);
    assert.equal((await change(a, "submit", partial.revision)).status, 422);
    assert.equal((await request(`${a.base}/act`, a.user.cookie, { type: "answer", taskId: a.task.id, key: "checked", value: true })).status, 409);
    assert.equal((await teacherReview(a, "Too early")).status, 409);
    assert.equal((await read(a)).status, "DRAFT");
    await queue([]);

    const fullPayload = { val: { 0: "First revision", 1: "Second line" } };
    const full = await ok(await change(a, "save", partial.revision, fullPayload));
    await queue([]);
    const submitRace = await Promise.all([change(a, "submit", full.revision), change(a, "submit", full.revision)]);
    assert.deepEqual(submitRace.map(({ status }) => status).sort(), [200, 409]);
    assert.equal((await change(a, "submit", (await read(a)).homeworkRevision)).status, 409);
    assert.equal((await read(b)).status, "DRAFT");
    await queue([a]);
    const classReview = await page(a, teacher.cookie);
    assert.equal(classReview.status, 200);
    const classHtml = await classReview.text();
    assert.match(classHtml, /First revision/);
    assert.match(classHtml, /Ждёт проверки/);

    const fullB = await ok(await change(b, "save", (await read(b)).homeworkRevision, fullPayload));
    await ok(await change(b, "submit", fullB.revision));
    await queue([a, b]);
    await ok(await teacherReview(a, `second-${a.comment}`));
    await queue([b]);
    await ok(await change(a, "start", (await read(a)).homeworkRevision));
    const history = (await ok(await request(a.path, a.user.cookie))).archived;
    assert.equal(history.length, 2);
    assert.deepEqual(history[0].payload, fullPayload);
    assert.equal(history[0].review.comment, `second-${a.comment}`);
    assert.deepEqual(history[1], archivedForA[0]);
    assert.equal((await read(a)).previousHomeworkAttemptId, history[0].id);
    assert.equal((await db.homeworkAttempt.findFirstOrThrow({ where: { answerId: b.answer.id } })).answerId, b.answer.id);

    await ok(await request(`${b.base}/act`, teacher.cookie, { type: "point", taskId: b.task.id }));
    const decoder = new TextDecoder();
    let events = "";
    while (!events.includes("event: point")) {
      const chunk = await reader.read();
      assert.ok(!chunk.done, "Expected a class event to reach the second pupil");
      events += decoder.decode(chunk.value, { stream: true });
    }
    assert.ok(events.includes(b.comment));
    assert.ok(!events.includes(a.comment));
    assert.ok(!events.includes(a.original.val[0]));
    assert.ok(!events.includes("event: homeworkRevision"));
  } finally {
    await reader.cancel();
  }
}

runTest().then(() => console.log("HW-24: queue, count, drafts, history, concurrency and group isolation passed")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try { await db.user.deleteMany({ where: { id: { in: sessionIds } } }); } finally { await db.$disconnect(); }
});
