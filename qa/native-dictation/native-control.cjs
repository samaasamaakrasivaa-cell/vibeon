const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const run = require("node:util").promisify(execFile);
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
        args: ["--no-sandbox", "--accept-lang=" + lang, "--use-fake-ui-for-media-stream"],
      });
      try {
        await context.grantPermissions(["microphone"], { origin });
        const page = context.pages()[0];
        await page.goto(origin + "/control");
        await page.waitForFunction(l => SpeechRecognition.available({ langs: [l], processLocally: true })
          .then(state => state === "available"), lang, { timeout: 25_000 });
        await page.evaluate(language => {
          window.measurement = { events: [], final: "" };
          document.querySelector("#recognize").onclick = async () => {
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
        await page.waitForFunction(() => window.measurement.events.some(event => event === "audiostart" || event.startsWith("error:")),
          null, { timeout: 15_000 }).catch(() => {});
        const started = await page.evaluate(() => window.measurement.events.includes("audiostart"));
        if (started) {
          await page.waitForTimeout(1200);
          await run("paplay", ["--device=dictation_qa", path.join(scratch, key + ".wav")]);
          await page.waitForTimeout(1000);
        }
        await page.evaluate(() => window.control?.stop());
        await page.waitForFunction(() => window.measurement.events.includes("end"), null, { timeout: 15_000 }).catch(() => {});
        const result = await page.evaluate(() => window.measurement);
        const matches = started && expected.test(result.final);
        console.log(lang, "bare Chrome start() with loopback only", { audiosource: "remapped PulseAudio microphone", events: result.events, transcriptMatches: matches });
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
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline && !execFileSync("pactl", ["list", "short", "source-outputs"], { encoding: "utf8" }).trim()) {
          await page.waitForTimeout(200);
        }
        assert.ok(execFileSync("pactl", ["list", "short", "source-outputs"], { encoding: "utf8" }).trim());
        await page.waitForTimeout(1200);
        await run("paplay", ["--device=dictation_qa", path.join(scratch, key + ".wav")]);
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
