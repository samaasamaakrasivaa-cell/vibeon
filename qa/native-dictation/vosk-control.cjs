const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const scratch = process.env.RUNNER_TEMP;
const modules = path.join(scratch, "browser/node_modules");
const { chromium } = require(path.join(modules, "playwright-core"));
const origin = "http://127.0.0.1:3334";

async function recognizeLanguage(page, lang) {
  return page.evaluate(async (language) => {
    const started = performance.now();
    const modelUrl = new URL("/models/" + language + ".tar.gz", location.href).href;
    let loadTimer;
    const model = await Promise.race([
      Vosk.createModel(modelUrl),
      new Promise((_, reject) => {
        loadTimer = setTimeout(() => reject(new Error("Worker model startup exceeded 30 seconds")), 30000);
      }),
    ]).finally(() => clearTimeout(loadTimer));
    const loading = performance.now() - started;
    const context = new AudioContext({ sampleRate: 16000 });
    const sound = await fetch("/" + language + ".wav").then(response => response.arrayBuffer())
      .then(buffer => context.decodeAudioData(buffer));
    const recognizer = new model.KaldiRecognizer(sound.sampleRate);
    const parts = [];
    const recognizedAt = performance.now();
    try {
      const final = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Final result not received")), 30000);
        recognizer.on("result", message => {
          const text = message.result.text?.trim();
          if (!text) return;
          parts.push(text);
          clearTimeout(timer);
          resolve(parts.join(" "));
        });
        recognizer.acceptWaveformFloat(sound.getChannelData(0).slice(), sound.sampleRate);
        recognizer.retrieveFinalResult();
      });
      return { final, loading: Math.round(loading), recognition: Math.round(performance.now() - recognizedAt), duration: sound.duration };
    } finally {
      recognizer.remove();
      model.terminate();
      await context.close();
    }
  }, lang);
}

async function main() {
  const interfaces = execFileSync("ip", ["-o", "link", "show"], { encoding: "utf8" }).trim().split("\n");
  assert.equal(interfaces.length, 1);
  assert.match(interfaces[0], /: lo:/);
  const original = fs.readFileSync(path.join(modules, "vosk-browser/dist/vosk.js"), "utf8");
  const start = original.indexOf("var WorkerFactory = createBase64WorkerFactory(");
  const end = original.indexOf(";", start) + 1;
  const encoded = original.slice(start, end).match(/createBase64WorkerFactory\('([A-Za-z0-9+/=]+)'/);
  assert.ok(start >= 0 && end > start && encoded, "Pinned worker packaging changed");
  const worker = Buffer.from(encoded[1], "base64").toString("utf8");
  const standalone = worker.slice(worker.indexOf("\n", 10) + 1);
  const library = original.slice(0, start) +
    'var WorkerFactory = function WorkerFactory(options) { return new Worker("/vosk-worker.js", options); };' + original.slice(end);
  const files = new Map([
    ["/models/en.tar.gz", path.join(scratch, "en.tar.gz")],
    ["/models/ru.tar.gz", path.join(scratch, "ru.tar.gz")],
    ["/en.wav", path.join(scratch, "en.wav")],
    ["/ru.wav", path.join(scratch, "ru.wav")],
  ]);
  let outgoing = 0;
  const saves = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/mic") {
      const chunks = [];
      for await (const data of req) chunks.push(data);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      assert.deepEqual(Array.from(form.keys()), ["observation"]);
      saves.push(form.get("observation"));
      return res.end("Saved");
    }
    if (req.method !== "GET") return res.writeHead(405).end();
    const url = new URL(req.url, origin);
    if (url.pathname === "/pcm-worklet.js" || url.pathname === "/vosk-mic-client.js") {
      res.setHeader("Content-Type", "application/javascript");
      return res.end(fs.readFileSync(path.join(__dirname, url.pathname.slice(1))));
    }
    if (url.pathname === "/mic") {
      res.setHeader("Content-Type", "text/html;charset=utf-8");
      res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'; form-action 'self'");
      return res.end('<!doctype html><html lang="en"><script src="/vosk.js" defer></script><script src="/vosk-mic-client.js" defer></script>' +
        '<form method="post" action="/mic"><label for="note">Observation</label><textarea id="note" name="observation">Manual prefix</textarea>' +
        '<button type="button" id="start">Start</button><button type="button" id="stop" disabled>Stop</button>' +
        '<p role="status" id="status"></p><button type="submit">Save</button></form></html>');
    }
    if (req.url === "/vosk.js" || req.url === "/vosk-worker.js") {
      res.setHeader("Content-Type", "application/javascript");
      if (req.url === "/vosk-worker.js") {
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-eval'; " +
          "connect-src " + origin + "/models/; worker-src 'none'");
      }
      return res.end(req.url === "/vosk.js" ? library : standalone);
    }
    const file = files.get(req.url);
    if (file) {
      if (req.url.endsWith(".js")) res.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.url !== "/") return res.writeHead(404).end();
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'self'");
    res.end('<!doctype html><html><title>Local worker prototype</title><script src="/vosk.js"></script></html>');
  }).listen(3334, "127.0.0.1");

  await new Promise(resolve => server.once("listening", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
    for (const [lang, expected] of [
      ["en", /cat|sleeps|teacher|exercises/i],
      ["ru", /читать|книг|урок|время/i],
    ]) {
      const page = await browser.newPage();
      page.on("console", event => {
        if (event.type() === "error") console.log("Browser error:", event.text());
      });
      page.on("pageerror", error => console.log("Native page error:", error.message));
      page.on("requestfailed", request => console.log("Local fixture request failed:", new URL(request.url()).pathname, request.failure()?.errorText));
      page.on("request", request => {
        if (!request.url().startsWith(origin + "/") && !request.url().startsWith("blob:" + origin + "/")) outgoing++;
      });
      try {
        await page.goto(origin);
        const outcome = await recognizeLanguage(page, lang);
        assert.match(outcome.final, expected);
        console.log(lang, "transcript:", outcome.final, "audio seconds:", outcome.duration,
          "model bytes:", fs.statSync(path.join(scratch, lang + ".tar.gz")).size,
          "model load ms:", outcome.loading, "recognition ms:", outcome.recognition);
      } finally { await page.close(); }
    }
    assert.equal(outgoing, 0);
    assert.equal(saves.length, 0);
    await browser.close();
    for (const [language, expected, speechMs] of [
      ["en", /cat|sleeps|teacher|exercises/i, 7000],
      ["ru", /читать|книг|урок|время/i, 8000],
    ]) {
      browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox",
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
        "--use-file-for-fake-audio-capture=" + path.join(scratch, language + "-mic.wav")] });
      const page = await browser.newPage({ permissions: ["microphone"] });
      await page.goto(origin + "/mic?lang=" + language);
      const previous = saves.length;
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByText("Recording", { exact: true }).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(speechMs);
      assert.equal(saves.length, previous);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.getByText("Ready", { exact: true }).waitFor({ timeout: 15_000 });
      const value = await page.getByLabel("Observation").inputValue();
      assert.match(value, expected);
      assert.ok(value.startsWith("Manual prefix "));
      assert.equal(saves.length, previous);
      const request = page.waitForResponse(response => response.request().method() === "POST" && response.url() === origin + "/mic");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      assert.equal((await request).status(), 200);
      assert.equal(saves.at(-1), value);
      console.log(language, "virtual microphone through AudioWorklet appended to the draft and reached the server only after explicit save; transcript:", value);
      await browser.close();
    }
    console.log("Both languages recognized. Loopback only, no outgoing browser requests and no audio uploads.");
  } finally {
    await browser?.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
