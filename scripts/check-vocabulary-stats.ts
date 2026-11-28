import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.DATABASE_URL !== "postgresql://vibeon:vibeon@localhost:5432/vibeon") {
  throw new Error("VOC-09 test requires the disposable GitHub Actions PostgreSQL service");
}
const db = new PrismaClient();
const origin = "http://127.0.0.1:3000";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const users: string[] = [];
const suffix = randomUUID();
const teacherPage = "/teacher/students?tab=profiles";
const studentPage = (id: string) => "/teacher/students/" + id + "?tab=progress";

async function user(name: string, role: "TEACHER" | "STUDENT") {
  const u = await db.user.create({ data: {
    email: name + "." + suffix + "@example.invalid", name, role, emailVerifiedAt: new Date(),
    ...(role === "TEACHER" ? { teacherProfile: { create: { trialUntil: new Date(Date.now() + 864e5) } } } : {}),
  } });
  users.push(u.id);
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId: u.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600e3) } });
  return { id: u.id, token };
}

async function page(path: string, token: string, lang = "en") {
  const res = await fetch(origin + path, { redirect: "manual", cache: "no-store", headers: { cookie: "vo_session=" + token + "; lang=" + lang } });
  return { status: res.status, location: res.headers.get("location"), html: await res.text() };
}

function stats(html: string, scope: "active" | "student", expected: Record<string, string | number>) {
  assert(html.includes('data-vocabulary-stats="' + scope + '"'), "missing vocabulary card: " + scope);
  for (const [key, value] of Object.entries(expected)) {
    const match = html.match(new RegExp('data-vocab-metric="' + key + '"[^>]*data-value="([^"]*)"'));
    assert.equal(match?.[1], String(value), "metric " + key);
  }
}

/** Use the existing runner's browser and Chrome DevTools protocol; no installs or external navigation. */
async function browserCheck(token: string, paths: string[]) {
  const chrome = ["google-chrome", "chromium", "chromium-browser"].find((cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0);
  assert(chrome, "No preinstalled Chromium/Chrome browser for mandatory mobile check");
  const dir = await mkdtemp(join(tmpdir(), "vibeon-voc09-"));
  const proc = spawn(chrome, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--no-first-run",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--remote-allow-origins=*",
    "--user-data-dir=" + dir, "about:blank",
  ], { stdio: "ignore" });
  let ws: WebSocket | undefined;
  try {
    let port = "";
    for (let i = 0; i < 100 && !port; i++) {
      if (proc.exitCode !== null) throw new Error("Browser exited before CDP startup");
      try { port = (await readFile(join(dir, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { await sleep(100); }
    }
    assert(port, "Browser CDP startup timeout");
    const tabs = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json() as { type: string; webSocketDebuggerUrl: string }[];
    const target = tabs.find((tab) => tab.type === "page");
    assert(target, "Browser page unavailable");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    ws = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP socket timeout")), 10000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP socket failed")); }, { once: true });
    });
    let seq = 0;
    const call = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
      const id = ++seq;
      const listener = (event: MessageEvent) => {
        const response = JSON.parse(String(event.data));
        if (response.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener("message", listener);
        if (response.error) reject(new Error("CDP command failed: " + method));
        else resolve(response.result);
      };
      const timer = setTimeout(() => { socket.removeEventListener("message", listener); reject(new Error("CDP timeout: " + method)); }, 15000);
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id, method, params }));
    });
    await call("Network.enable");
    assert((await call("Network.setCookie", { name: "vo_session", value: token, url: origin, httpOnly: true, sameSite: "Lax" })).success);
    assert((await call("Network.setCookie", { name: "lang", value: "en", url: origin })).success);
    await call("Page.enable");
    for (const width of [320, 1280]) {
      await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 320 });
      for (const path of paths) {
        await call("Page.navigate", { url: origin + path });
        let bounds: { viewport: number; left: number; right: number; scroll: number; client: number } | null = null;
        for (let i = 0; i < 100; i++) {
          const result = await call("Runtime.evaluate", { returnByValue: true, expression:
            "(() => { const el = document.querySelector('[data-vocabulary-stats]'); if (!el || document.readyState !== 'complete' || location.pathname + location.search !== " +
            JSON.stringify(path) + ") return null; const r = el.getBoundingClientRect(); return { viewport: innerWidth, left: r.left, right: r.right, scroll: el.scrollWidth, client: el.clientWidth }; })()" });
          bounds = result.result?.value ?? null;
          if (bounds) break;
          await sleep(200);
        }
        assert(bounds, "Vocabulary card did not render in browser");
        assert.equal(bounds.viewport, width, "unexpected layout viewport");
        assert(bounds.client > 0 && bounds.left >= -1 && bounds.right <= width + 1 && bounds.scroll <= bounds.client + 1, "Vocabulary card overflows viewport at " + width);
      }
    }
  } finally {
    ws?.close();
    proc.kill();
    for (let i = 0; i < 20 && proc.exitCode === null && proc.signalCode === null; i++) await sleep(100);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function main() {
  const a = await user("voc09-teacher-a", "TEACHER");
  const b = await user("voc09-teacher-b", "TEACHER");
  const learner = await user("voc09-student", "STUDENT");
  const one = await db.student.create({ data: { teacherId: a.id, userId: learner.id, name: "VOC09 one", gender: "f", status: "ACTIVE" } });
  const empty = await db.student.create({ data: { teacherId: a.id, name: "VOC09 empty", gender: "f", status: "ACTIVE" } });
  const archived = await db.student.create({ data: { teacherId: a.id, name: "VOC09 archived", gender: "f", status: "ARCHIVED" } });
  const foreign = await db.student.create({ data: { teacherId: b.id, name: "VOC09 foreign", gender: "f", status: "ACTIVE" } });
  const at = new Date("2026-01-02T08:00:00Z");
  await db.word.createMany({ data: [
    { studentId: one.id, word: "one", sourceLessonId: "synthetic-lesson", createdAt: at },
    { studentId: one.id, word: "two", sourceLessonId: "synthetic-lesson", createdAt: at },
    { studentId: one.id, word: "three", createdAt: at },
    { studentId: one.id, word: "four", sourceLessonId: "", createdAt: at },
    { studentId: archived.id, word: "archived", createdAt: at },
    { studentId: foreign.id, word: "foreign", createdAt: at },
  ] });
  await db.wordPractice.createMany({ data: [
    { studentId: one.id, day: "2026-01-01", count: 2 },
    { studentId: one.id, day: "2026-01-03", count: 3 },
    { studentId: one.id, day: "2026-01-04", count: 0 },
    { studentId: archived.id, day: "2026-01-05", count: 88 },
    { studentId: foreign.id, day: "2026-01-06", count: 99 },
  ] });
  const common = { words: 4, linked: 2, unlinked: 2, practiced: 5, lastPracticeDay: "2026-01-03" };
  let result = await page(teacherPage, a.token);
  assert.equal(result.status, 200);
  stats(result.html, "active", { students: 2, ...common });
  assert(result.html.includes("Active students&#x27; vocabulary") || result.html.includes("Active students' vocabulary"));
  result = await page(studentPage(one.id), a.token, "ru");
  assert.equal(result.status, 200);
  stats(result.html, "student", common);
  assert(result.html.includes("Словарь и тренировки"));
  result = await page(studentPage(empty.id), a.token);
  assert.equal(result.status, 200);
  stats(result.html, "student", { words: 0, linked: 0, unlinked: 0, practiced: 0, lastPracticeDay: "", lastAddedAt: "" });
  assert(result.html.includes("No records"));
  result = await page(studentPage(archived.id), a.token);
  assert.equal(result.status, 200);
  stats(result.html, "student", { words: 1, practiced: 88 });
  result = await page(teacherPage, b.token);
  assert.equal(result.status, 200);
  stats(result.html, "active", { students: 1, words: 1, practiced: 99 });
  for (const [path, token] of [[studentPage(one.id), b.token], [studentPage(foreign.id), a.token], [studentPage(one.id), learner.token], [teacherPage, learner.token]]) {
    result = await page(path, token);
    assert(!result.html.includes('data-vocabulary-stats="'), "foreign or wrong-role stats exposed");
    assert(result.status === 404 || (result.status >= 300 && result.status < 400) || result.html.includes("NEXT_REDIRECT") || result.html.includes("NEXT_HTTP_ERROR_FALLBACK;404"), "expected denial or redirect");
  }
  await db.wordPractice.update({ where: { studentId_day: { studentId: one.id, day: "2026-01-03" } }, data: { count: { increment: 1 } } });
  result = await page(teacherPage, a.token);
  stats(result.html, "active", { students: 2, ...common, practiced: 6 });
  result = await page(studentPage(one.id), a.token);
  stats(result.html, "student", { ...common, practiced: 6 });
  await browserCheck(a.token, [teacherPage, studentPage(one.id)]);
  assert.equal(await db.word.count({ where: { studentId: one.id } }), 4);
  assert.equal((await db.wordPractice.findUniqueOrThrow({ where: { studentId_day: { studentId: one.id, day: "2026-01-03" } } })).count, 4);
  console.log("VOC-09: teacher scope, student scope, archive/foreign/role denial, empty/legacy source, repeat, RU/EN, mobile 320px and desktop 1280px passed");
}

main().finally(async () => {
  try { if (users.length) await db.user.deleteMany({ where: { id: { in: users } } }); }
  finally { await db.$disconnect(); }
}).catch((error) => {
  console.error("VOC-09 isolated test failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
