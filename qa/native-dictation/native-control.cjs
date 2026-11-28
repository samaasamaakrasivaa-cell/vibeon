const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const scratch = process.env.RUNNER_TEMP;
const { chromium } = require(path.join(scratch, "browser/node_modules/playwright-core"));
const profile = path.join(scratch, "voice-profile");
const origin = "http://127.0.0.1:3334";
const fixture = '<!doctype html><html lang="en"><div id="root"></div><script src="/fixture.js"></script>';
const control = '<!doctype html><html lang="en"><title>Native microphone control</title><button id="recognize">Recognize synthetic input</button>';

async function main() {
  const interfaces = execFileSync("ip", ["-o", "link", "show"], { encoding: "utf8" }).trim().split("\n");
  assert.equal(interfaces.length, 1);
  assert.match(interfaces[0], /: lo:/);
  const preferences = path.join(profile, "Default/Preferences");
  const prefs = JSON.parse(fs.readFileSync(preferences, "utf8"));
  prefs.profile ??= {};
  prefs.profile.content_settings ??= {};
  prefs.profile.content_settings.exceptions ??= {};
  prefs.profile.content_settings.exceptions.media_stream_mic = { [origin + ",*"]: { setting: 1 } };
  fs.writeFileSync(preferences, JSON.stringify(prefs));
  let saves = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
      saves++;
      return res.end("Saved");
    }
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "application/javascript");
      return res.end(fs.readFileSync(path.join(scratch, "fixture.js")));
    }
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(req.url === "/control" ? control : fixture);
  }).listen(3334, "127.0.0.1");

  let pass = true;
  try {
    await new Promise(resolve => server.once("listening", resolve));
    for (const [key, lang, expected] of [
      ["en", "en-US", /cat|sleeps|sofa/i],
      ["ru", "ru-RU", /нравится|читать|книг/i],
    ]) {
      const context = await chromium.launchPersistentContext(profile, {
        executablePath: "/usr/bin/google-chrome", headless: false, locale: lang, permissions: ["microphone"],
        ignoreDefaultArgs: ["--disable-background-networking", "--disable-component-update", "--mute-audio"],
        args: ["--no-sandbox", "--accept-lang=" + lang, "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream", "--use-file-for-fake-audio-capture=" + path.join(scratch, key + ".wav")],
      });
      try {
        await context.grantPermissions(["microphone"], { origin });
        const page = context.pages()[0];
        await page.goto(origin + "/control");
        await page.waitForFunction(l => SpeechRecognition.available({ langs: [l], processLocally: true })
          .then(state => state === "available"), lang, { timeout: 25_000 });
        await page.evaluate(language => {
          window.measurement = { peak: 0, events: [], final: "" };
          document.querySelector("#recognize").onclick = async () => {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audio = new AudioContext();
            await audio.resume();
            const analyser = audio.createAnalyser();
            audio.createMediaStreamSource(stream).connect(analyser);
            const capture = new Float32Array(analyser.fftSize);
            const until = performance.now() + 2600;
            while (performance.now() < until) {
              analyser.getFloatTimeDomainData(capture);
              const max = capture.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
              window.measurement.peak = Math.max(window.measurement.peak, max);
              await new Promise(resolve => setTimeout(resolve, 40));
            }
            stream.getTracks().forEach(track => track.stop());
            await audio.close();
            const recognition = new SpeechRecognition();
            recognition.processLocally = true;
            if (recognition.processLocally !== true) throw new Error("Local mode not selected");
            recognition.lang = language;
            recognition.continuous = true;
            recognition.interimResults = false;
            for (const name of ["start", "audiostart", "speechstart", "speechend", "audioend", "end"]) {
              recognition.addEventListener(name, () => window.measurement.events.push(name));
            }
            recognition.onerror = (event) => window.measurement.events.push("error:" + event.error);
            recognition.onresult = event => {
              window.measurement.events.push("result");
              window.measurement.final = Array.from(event.results).filter(item => item.isFinal)
                .map(item => item[0].transcript).join(" ");
            };
            window.control = recognition;
            recognition.start();
          };
        }, lang);
        await page.locator("#recognize").click();
        await page.waitForFunction(() => window.control !== undefined, null, { timeout: 15_000 }).catch(() => {});
        await page.waitForFunction(() => window.measurement.events.includes("result") || window.measurement.events.includes("end"),
          null, { timeout: 12_000 }).catch(() => {});
        await page.evaluate(() => window.control?.stop());
        await page.waitForFunction(() => window.measurement.events.includes("end"), null, { timeout: 15_000 }).catch(() => {});
        const result = await page.evaluate(() => window.measurement);
        const matches = result.peak > .01 && expected.test(result.final);
        console.log(lang, "bare Chrome start() with loopback only", { peak: result.peak, events: result.events, transcriptMatches: matches });
        if (!matches) {
          pass = false;
          continue;
        }
        const previous = saves;
        await page.goto(origin);
        await page.getByLabel("Dictation language").selectOption(lang);
        await page.getByRole("button", { name: "Dictate", exact: true }).click();
        const stop = page.getByRole("button", { name: "Stop", exact: true });
        await stop.waitFor({ timeout: 12_000 });
        await page.waitForTimeout(10_000);
        assert.equal(saves, previous);
        if (await stop.isVisible()) await stop.click();
        const field = page.getByLabel("Synthetic observation");
        await page.waitForFunction(() => document.querySelector("textarea").value.length > "Manual prefix".length, null, { timeout: 15_000 });
        const text = await field.inputValue();
        assert.match(text, expected);
        assert.ok(text.startsWith("Manual prefix "));
        assert.equal(saves, previous);
        console.log(lang, "VibeOn microphone passed on the same synthetic source");
      } catch (error) {
        pass = false;
        console.log(lang, "test failed:", error.message);
      } finally { await context.close(); }
    }
  } finally { server.close(); }
  assert.equal(pass, true, "Native Chrome and VibeOn must both recognize both synthetic samples");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
