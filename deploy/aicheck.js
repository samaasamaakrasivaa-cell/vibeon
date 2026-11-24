// Проверка ИИ на сервере: тестовые запросы к Yandex Cloud (текст, озвучка, распознавание речи, OCR).
// Только свои примеры — данные платформы не читаются. Ключи берутся из окружения контейнера и не печатаются.
const folder = process.env.YANDEX_CLOUD_FOLDER_ID || "", key = process.env.YANDEX_CLOUD_API_KEY || "";
const H = { Authorization: `Api-Key ${key}`, "x-folder-id": folder };
const short = (s) => String(s).replace(/\s+/g, " ").slice(0, 220);
let bad = 0;
const report = (name, ok, info) => { console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${info}`); if (!ok) bad++; };

async function llm(model) {
  const r = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ modelUri: `gpt://${folder}/${model}`, completionOptions: { stream: false, temperature: 0, maxTokens: "60" }, messages: [{ role: "system", text: "You check English grammar. Answer in one short line." }, { role: "user", text: "Correct this sentence: I go to London last year." }] }),
  });
  const b = await r.text();
  if (!r.ok) return report(`текст (${model})`, false, `HTTP ${r.status} ${short(b)}`);
  report(`текст (${model})`, true, short(JSON.parse(b).result?.alternatives?.[0]?.message?.text ?? ""));
}

async function speech() {
  const r = await fetch("https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize", {
    method: "POST", headers: { Authorization: H.Authorization, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text: "Hello! I think learning English is very useful.", lang: "en-US", voice: process.env.YANDEX_TTS_VOICE || "john", format: "lpcm", sampleRateHertz: "16000", folderId: folder }),
  });
  if (!r.ok) { report("озвучка (SpeechKit TTS)", false, `HTTP ${r.status} ${short(await r.text())}`); return report("распознавание речи (SpeechKit STT)", false, "нет аудио из озвучки — не проверено"); }
  const pcm = Buffer.from(await r.arrayBuffer());
  report("озвучка (SpeechKit TTS)", pcm.length > 1000, `${Math.round(pcm.length / 32000 * 10) / 10} с аудио`);
  const s = await fetch(`https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?folderId=${folder}&lang=en-US&format=lpcm&sampleRateHertz=16000`, { method: "POST", headers: { Authorization: H.Authorization }, body: new Uint8Array(pcm) });
  const b = await s.text();
  if (!s.ok) return report("распознавание речи (SpeechKit STT)", false, `HTTP ${s.status} ${short(b)}`);
  report("распознавание речи (SpeechKit STT)", true, `«${short(JSON.parse(b).result ?? "")}»`);
}

async function ocr() {
  // белая картинка 1×1: проверяем доступ к Vision OCR (текста на ней нет — ответ пустой)
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";
  const r = await fetch("https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ mimeType: "PNG", languageCodes: ["en", "ru"], model: "page", content: png }) });
  const b = await r.text();
  report("распознавание текста (Vision OCR)", r.ok, r.ok ? "доступ есть" : `HTTP ${r.status} ${short(b)}`);
}

(async () => {
  console.log(`AI_PROVIDER=${process.env.AI_PROVIDER || "(пусто)"} · каталог задан: ${folder ? "да" : "нет"} · ключ задан: ${key ? "да" : "нет"}`);
  if (!folder || !key) { console.log("FAIL нет ключей в окружении контейнера"); process.exit(1); }
  for (const f of [() => llm(process.env.AI_MODEL_FAST || "yandexgpt-lite/latest"), () => llm(process.env.AI_MODEL_STRONG || "yandexgpt/latest"), speech, ocr]) {
    try { await f(); } catch (e) { report("запрос", false, short(e.message)); }
  }
  console.log(bad ? `Итог: ошибок ${bad}` : "Итог: всё работает");
})();
