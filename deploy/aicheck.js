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


// node aicheck.js probe — какие модели доступны каталогу и по какому адресу API (ничего из данных платформы не читается)
async function probe() {
  const OH = { Authorization: H.Authorization, "OpenAI-Project": folder, "x-folder-id": folder, "Content-Type": "application/json" };
  for (const base of ["https://llm.api.cloud.yandex.net/v1", "https://ai.api.cloud.yandex.net/v1"]) {
    try {
      const r = await fetch(`${base}/models`, { headers: OH });
      const b = await r.text();
      let ids = "";
      try { ids = (JSON.parse(b).data ?? []).map((m) => m.id).join(", "); } catch { ids = short(b); }
      console.log(`MODELS ${base}/models → HTTP ${r.status}: ${short(ids).slice(0, 2000)}`);
      if (r.ok) try { for (const m of JSON.parse(b).data ?? []) console.log(`  model: ${m.id}`); } catch {}
    } catch (e) { console.log(`MODELS ${base} → ${short(e.message)}`); }
  }
  const names = (process.argv[3] || "qwen3-235b-a22b-fp8/latest,deepseek-v32/latest,deepseek-v3.2/latest,qwen3-235b-a22b/latest,gpt-oss-120b/latest,yandexgpt/latest").split(",");
  const msg = [{ role: "user", content: "Reply with one word: OK" }];
  for (const n of names) {
    const uri = `gpt://${folder}/${n}`;
    for (const base of ["https://llm.api.cloud.yandex.net/v1", "https://ai.api.cloud.yandex.net/v1"]) {
      try {
        const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: OH, body: JSON.stringify({ model: uri, messages: msg, max_tokens: 20, temperature: 0 }) });
        const b = await r.text();
        let out = short(b);
        try { const j = JSON.parse(b); if (r.ok) out = `«${short(j.choices?.[0]?.message?.content ?? "")}» model=${j.model ?? ""}`; } catch {}
        console.log(`${r.ok ? "OK  " : "FAIL"} openai ${base.replace("https://", "")} ${n}: HTTP ${r.status} ${out}`);
      } catch (e) { console.log(`FAIL openai ${base} ${n}: ${short(e.message)}`); }
    }
    try {
      const r = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ modelUri: uri, completionOptions: { stream: false, temperature: 0, maxTokens: "20" }, messages: [{ role: "user", text: "Reply with one word: OK" }] }) });
      const b = await r.text();
      let out = short(b);
      try { const j = JSON.parse(b); if (r.ok) out = `«${short(j.result?.alternatives?.[0]?.message?.text ?? "")}»`; } catch {}
      console.log(`${r.ok ? "OK  " : "FAIL"} native ${n}: HTTP ${r.status} ${out}`);
    } catch (e) { console.log(`FAIL native ${n}: ${short(e.message)}`); }
  }
}

(async () => {
  console.log(`AI_PROVIDER=${process.env.AI_PROVIDER || "(пусто)"} · каталог задан: ${folder ? "да" : "нет"} · ключ задан: ${key ? "да" : "нет"}`);
  if (!folder || !key) { console.log("FAIL нет ключей в окружении контейнера"); process.exit(1); }
  if (process.argv[2] === "probe") return probe();
  for (const f of [() => llm(process.env.AI_MODEL_FAST || "yandexgpt-lite/latest"), () => llm(process.env.AI_MODEL_STRONG || "yandexgpt/latest"), speech, ocr]) {
    try { await f(); } catch (e) { report("запрос", false, short(e.message)); }
  }
  console.log(bad ? `Итог: ошибок ${bad}` : "Итог: всё работает");
})();
