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
    const modelUrl = new URL("/" + language + ".tar.gz", location.href).href;
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
  const files = new Map([
    ["/vosk.js", path.join(modules, "vosk-browser/dist/vosk.js")],
    ["/en.tar.gz", path.join(scratch, "en.tar.gz")],
    ["/ru.tar.gz", path.join(scratch, "ru.tar.gz")],
    ["/en.wav", path.join(scratch, "en.wav")],
    ["/ru.wav", path.join(scratch, "ru.wav")],
  ]);
  let outgoing = 0;
  let writes = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== "GET") {
      writes++;
      return res.writeHead(405).end();
    }
    const file = files.get(req.url);
    if (file) {
      if (req.url.endsWith(".js")) res.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.url !== "/") return res.writeHead(404).end();
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src blob: 'self'");
    res.end('<!doctype html><html><title>Local worker prototype</title><script src="/vosk.js"></script></html>');
  }).listen(3334, "127.0.0.1");

  await new Promise(resolve => server.once("listening", resolve));
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  try {
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
    assert.equal(writes, 0);
    console.log("Both languages recognized. Loopback only, no outgoing browser requests and no audio uploads.");
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
