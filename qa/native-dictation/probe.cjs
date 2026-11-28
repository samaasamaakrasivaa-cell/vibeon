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
const fixturePage = '<!doctype html><html lang="en"><div id="root"></div><script src="/fixture.js"></script>';
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
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "application/javascript");
      return res.end(fs.readFileSync(path.join(scratch, "fixture.js")));
    }
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(mode === "prepare" ? setupPage : fixturePage);
  }).listen(3334, "127.0.0.1");
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const openBrowser = async (audio) => {
      const args = ["--no-sandbox","--accept-lang=en-US,ru-RU"];
      if (audio) args.push("--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
        "--use-file-for-fake-audio-capture=" + audio);
      const context = await chromium.launchPersistentContext(profile, { executablePath: "/usr/bin/google-chrome",
        ignoreDefaultArgs: mode === "prepare" ? ["--disable-background-networking", "--disable-component-update"] : [],
        args, permissions: ["microphone"], locale: "en-US" });
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
    for (const [key, language] of Object.entries(languages)) {
      const context = await openBrowser(path.join(scratch, key + ".wav"));
      try {
        const page = context.pages()[0];
        const expectedSaves = saves.length;
        await page.goto(origin);
        assert.equal(await availability(page, language), "available");
        const field = page.getByLabel("Synthetic observation");
        await page.getByLabel("Dictation language").selectOption(language);
        await page.getByRole("button", { name: "Dictate", exact: true }).click();
        await page.getByRole("button", { name: "Stop", exact: true }).waitFor({ timeout: 30_000 });
        await page.waitForTimeout(8_000);
        assert.equal(await field.inputValue(), "Manual prefix");
        assert.equal(saves.length, expectedSaves);
        const stop = page.getByRole("button", { name: "Stop", exact: true });
        if (await stop.isVisible()) await stop.click();
        await page.waitForFunction(() => document.querySelector("textarea").value.length > "Manual prefix".length, null, { timeout: 20_000 });
        const composed = await field.inputValue();
        assert.match(composed, key === "en" ? /cat|sleeps|sofa/i : /нравится|читать|книг/i);
        assert.equal(saves.length, expectedSaves);
        await page.getByRole("button", { name: "Save observation", exact: true }).click();
        await page.waitForURL(origin + "/");
        assert.equal(saves.at(-1), composed);
        console.log(language, "native transcript added and saved with loopback as the only interface");
      } finally { await context.close(); }
    }
  } finally { server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
