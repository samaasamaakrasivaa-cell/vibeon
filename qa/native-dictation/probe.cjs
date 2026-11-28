const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const scratch = process.env.RUNNER_TEMP;
const { chromium } = require(path.join(scratch, "browser/node_modules/playwright-core"));
const mode = process.argv[2];
const origin = "http://127.0.0.1:3334";
const profile = path.join(scratch, "voice-profile");
const setupPage = `<!doctype html><html lang="en"><button id="en">Prepare English</button><button id="ru">Prepare Russian</button>
<script>
  const langs = {en: 'en-US', ru: 'ru-RU'};
  for (const id of Object.keys(langs)) {
    document.getElementById(id).onclick = async () => {
      window.lastInstall = undefined;
      try { window.lastInstall = await SpeechRecognition.install({ langs: [langs[id]], processLocally: true }); }
      catch (error) { window.lastInstall = error.name; }
    };
  }
</script>`;
const fixturePage = `<!doctype html><html lang="en"><button id="source">Prepare synthetic voice source</button><div id="root"></div>
<script>
  document.getElementById('source').onclick = async () => {
    const context = new AudioContext({sampleRate:48000});
    await context.resume();
    const response = await fetch('/voice-' + window.qaVoice + '.wav');
    const audio = await context.decodeAudioData(await response.arrayBuffer());
    const stream = context.createMediaStreamDestination();
    const buffer = context.createBufferSource();
    buffer.buffer = audio;
    buffer.connect(stream);
    window.syntheticVoice = { buffer, track: stream.stream.getAudioTracks()[0] };
  };
</script><script src="/fixture.js"></script>`;
const languages = { en: "en-US", ru: "ru-RU" };

async function main() {
  assert.ok(mode === "prepare" || mode === "offline");
  if (mode === "prepare") {
    fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Default/Preferences"), JSON.stringify({ intl: { accept_languages: "en-US,ru-RU" } }));
  } else {
    const interfaces = execFileSync("ip", ["-o", "link", "show"], { encoding: "utf8" }).trim().split("\n");
    assert.equal(interfaces.length, 1);
    assert.match(interfaces[0], /: lo:/);
  }
  const saves = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      saves.push(new URLSearchParams(Buffer.concat(chunks).toString()).get("observation"));
      return res.end("Saved");
    }
    if (req.url === "/voice-en.wav" || req.url === "/voice-ru.wav") {
      res.setHeader("Content-Type", "audio/wav");
      return res.end(fs.readFileSync(path.join(scratch, req.url.slice(7))));
    }
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "application/javascript");
      return res.end(fs.readFileSync(path.join(scratch, "fixture.js")));
    }
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(mode === "prepare" ? setupPage : fixturePage);
  }).listen(3334, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const openBrowser = async (locale = "en-US") => {
      const args = ["--no-sandbox","--accept-lang=" + locale];
      const context = await chromium.launchPersistentContext(profile, { executablePath: "/usr/bin/google-chrome",
        ignoreDefaultArgs: ["--disable-background-networking", "--disable-component-update"],
        args, permissions: ["microphone"], locale });
      await context.grantPermissions(["microphone"], { origin });
      return context;
    };
    const availability = (page, language) => page.evaluate(lang =>
      SpeechRecognition.available({ langs: [lang], processLocally: true }), language);
    if (mode === "prepare") {
      const context = await openBrowser();
      try {
        const page = context.pages()[0];
        await page.goto(origin);
        for (const [key, language] of Object.entries(languages)) {
          if (await availability(page, language) === "available") continue;
          await page.locator("#" + key).click();
          await page.waitForFunction(() => window.lastInstall !== undefined, null, { timeout: 150_000 });
          const status = await availability(page, language);
          const installed = await page.evaluate(() => window.lastInstall);
          console.log(language, "install result", installed, "availability", status);
          assert.equal(status, "available");
        }
      } finally { await context.close(); }
      return;
    }
    const preferences = path.join(profile, "Default/Preferences");
    const prefs = JSON.parse(fs.readFileSync(preferences, "utf8"));
    prefs.intl = { ...prefs.intl, accept_languages: "en-US,ru-RU" };
    prefs.profile ??= {};
    prefs.profile.content_settings ??= {};
    prefs.profile.content_settings.exceptions ??= {};
    prefs.profile.content_settings.exceptions.media_stream_mic = { [origin + ",*"]: { setting: 1 } };
    fs.writeFileSync(preferences, JSON.stringify(prefs));
    for (const name of ["SODA", "SODALanguagePacks"]) {
      const dir = path.join(profile, name);
      console.log(name, fs.existsSync(dir) ? fs.readdirSync(dir, {recursive: true}).length : 0);
    }
    for (const [key, language] of Object.entries(languages)) {
      const context = await openBrowser(language);
      try {
        const page = context.pages()[0];
        const expectedSaves = saves.length;
        await page.addInitScript(key => {
          window.qaVoice = key;
          window.nativeEvents = [];
          const prototype = SpeechRecognition.prototype;
          const realStart = prototype.start;
          prototype.start = function (...args) {
            for (const key of ["start","audiostart","soundstart","speechstart","audioend","speechend","end","nomatch"]) {
              this.addEventListener(key, () => window.nativeEvents.push(key));
            }
            this.addEventListener("result", () => window.nativeEvents.push("result"));
            this.addEventListener("error", event => window.nativeEvents.push("error:" + event.error));
            if (!window.syntheticVoice?.track) throw new Error("Synthetic track is not ready");
            return realStart.call(this, window.syntheticVoice.track);
          };
        }, key);
        await page.goto(origin);
        let nativeStatus;
        for (let i = 0; i < 20; i++) {
          nativeStatus = await availability(page, language);
          if (nativeStatus === "available") break;
          await page.waitForTimeout(1000);
        }
        console.log(language, "offline availability", nativeStatus, await page.evaluate(async () => ({
          microphone: (await navigator.permissions.query({ name: "microphone" })).state,
          languages: navigator.languages,
        })));
        assert.equal(nativeStatus, "available");
        await page.locator("#source").click();
        await page.waitForFunction(() => window.syntheticVoice?.track?.readyState === "live");
        const field = page.getByLabel("Synthetic observation");
        await page.getByLabel("Dictation language").selectOption(language);
        await page.getByRole("button", { name: "Dictate", exact: true }).click();
        try {
          await page.getByRole("button", { name: "Stop", exact: true }).waitFor({ timeout: 15_000 });
        } catch (error) {
          console.log(language, "startup events", await page.evaluate(() => window.nativeEvents),
            await page.locator("[role=status]").allTextContents());
          throw error;
        }
        const duration = await page.evaluate(() => {
          window.syntheticVoice.buffer.start();
          return window.syntheticVoice.buffer.buffer.duration;
        });
        await page.waitForTimeout(Math.ceil(duration * 1000) + 1000);
        assert.equal(saves.length, expectedSaves);
        const stop = page.getByRole("button", { name: "Stop", exact: true });
        if (await stop.isVisible()) await stop.click();
        try {
          await page.waitForFunction(() => document.querySelector("textarea").value.length > "Manual prefix".length, null, { timeout: 15_000 });
        } finally {
          console.log(language, "native events", await page.evaluate(() => window.nativeEvents),
            await page.locator("[role=status]").allTextContents());
        }
        const composed = await field.inputValue();
        assert.match(composed, key === "en" ? /cat|sleeps|sofa/i : /нравится|читать|книг/i);
        assert.equal(saves.length, expectedSaves);
        const savedResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url() === origin + "/");
        await page.getByRole("button", { name: "Save observation", exact: true }).click();
        assert.equal((await savedResponse).status(), 200);
        assert.equal(saves.at(-1), composed);
        console.log(language, "native transcript added and saved with loopback as the only interface");
      } finally { await context.close(); }
    }
  } finally { server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
