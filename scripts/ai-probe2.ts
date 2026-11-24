// Пробы (deploy → aidemo probe2): картинки (YandexART / Alice AI ART), озвучка TTS Live и живой собеседник (Realtime API).
// Тестовые примеры, данные платформы не используются. Файлы — в /tmp/aiout (выкладка забирает их архивом).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import WebSocket from "ws";

const folder = process.env.YANDEX_CLOUD_FOLDER_ID || "", key = process.env.YANDEX_CLOUD_API_KEY || "";
const OUT = "/tmp/aiout";
const H = { Authorization: `Api-Key ${key}`, "x-folder-id": folder };
const short = (s: unknown) => String(s).replace(/\s+/g, " ").slice(0, 300);
const sec = (t0: number) => ((Date.now() - t0) / 1000).toFixed(1);

// ───────── Картинки ─────────

const WORDS = ["apple", "umbrella", "bicycle", "library", "to whisper", "brave"];
const style = (w: string) => `A simple friendly flat illustration for an English vocabulary flashcard showing "${w}". One clear subject in the center, plain white background, soft colours, no text, no letters, no words.`;

async function imageAsync(model: string, prompt: string) {
  const r = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/imageGenerationAsync", {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ modelUri: `art://${folder}/${model}`, generationOptions: { seed: 17, aspectRatio: { widthRatio: 1, heightRatio: 1 } }, messages: [{ weight: 1, text: prompt }] }),
  });
  const b = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${short(b)}`);
  const id = JSON.parse(b).id;
  for (let i = 0; i < 60; i++) {
    await new Promise((res) => setTimeout(res, 3000));
    const o = await (await fetch(`https://llm.api.cloud.yandex.net/operations/${id}`, { headers: H })).json();
    if (o.done) { if (o.error) throw new Error(short(JSON.stringify(o.error))); return Buffer.from(o.response.image, "base64"); }
  }
  throw new Error("timeout");
}

async function images() {
  for (const model of ["yandex-art/latest", "aliceai-art/latest", "alice-ai-art/latest"]) {
    for (const w of WORDS) {
      const t0 = Date.now();
      try {
        const img = await imageAsync(model, style(w));
        const f = `img-${model.split("/")[0]}-${w.replace(/\s+/g, "_")}.jpg`;
        writeFileSync(`${OUT}/${f}`, img);
        console.log(`IMG OK ${model} «${w}» ${sec(t0)} s ${img.length} bytes → ${f}`);
      } catch (e) {
        console.log(`IMG FAIL ${model} «${w}» ${sec(t0)} s: ${short((e as Error).message)}`);
        break; // модель недоступна — остальные слова не пробуем
      }
    }
  }
}

// ───────── Realtime (OpenAI-совместимый протокол) ─────────

function wav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

type RtResult = { ok: boolean; info: string; audio?: Buffer; rate?: number; firstAudioMs?: number; transcript?: string };

/** Одна сессия: подключиться, настроить, отправить текст, собрать аудио ответа. */
function realtime(url: string, model: string, opts: { voice?: string; instructions: string; text: string }): Promise<RtResult> {
  return new Promise((resolve) => {
    const events: string[] = [];
    const audio: Buffer[] = [];
    let transcript = "", rate = 24000, sent = 0, first = 0, done = false;
    const finish = (r: RtResult) => { if (done) return; done = true; try { ws.close(); } catch {} resolve({ ...r, info: `${r.info} · events: ${[...new Set(events)].slice(0, 25).join(",")}` }); };
    const ws = new WebSocket(url, { headers: { Authorization: `Api-Key ${key}`, "OpenAI-Project": folder, "x-folder-id": folder } });
    const timer = setTimeout(() => finish({ ok: audio.length > 0, info: "timeout 60s", audio: Buffer.concat(audio), rate, firstAudioMs: first ? first - sent : undefined, transcript }), 60000);
    ws.on("unexpected-response", (_req, res) => { let b = ""; res.on("data", (c: Buffer) => (b += c)); res.on("end", () => { clearTimeout(timer); finish({ ok: false, info: `HTTP ${res.statusCode} ${short(b)}` }); }); });
    ws.on("error", (e) => { clearTimeout(timer); finish({ ok: false, info: `ws error ${short(e.message)}` }); });
    ws.on("open", () => {
      const session: Record<string, unknown> = { type: "realtime", model, instructions: opts.instructions, output_modalities: ["audio"], audio: { output: { format: { type: "audio/pcm", rate: 24000 }, ...(opts.voice ? { voice: opts.voice } : {}) } } };
      ws.send(JSON.stringify({ type: "session.update", session }));
      ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: opts.text }] } }));
      sent = Date.now();
      ws.send(JSON.stringify({ type: "response.create" }));
    });
    ws.on("message", (raw) => {
      let m: Record<string, unknown>; try { m = JSON.parse(String(raw)); } catch { return; }
      const t = String(m.type); events.push(t);
      if (t === "session.created" || t === "session.updated") {
        const s = m.session as Record<string, unknown>;
        console.log(`  ${t}: ${short(JSON.stringify(s)).slice(0, 300)}`);
        const r = ((s?.audio as Record<string, Record<string, Record<string, number>>>)?.output?.format?.rate) ?? (s?.output_audio_format === "pcm16" ? 24000 : undefined);
        if (r) rate = r;
      }
      if (t === "response.output_audio.delta" || t === "response.audio.delta") { if (!first) first = Date.now(); audio.push(Buffer.from(String(m.delta), "base64")); }
      if (t === "response.output_audio_transcript.delta" || t === "response.audio_transcript.delta") transcript += String(m.delta ?? "");
      if (t === "error") { clearTimeout(timer); finish({ ok: false, info: `error ${short(JSON.stringify(m.error))}`, audio: Buffer.concat(audio), rate }); }
      if (t === "response.done") { clearTimeout(timer); finish({ ok: audio.length > 0, info: `done ${short(JSON.stringify((m.response as Record<string, unknown>)?.status_details ?? ""))}`, audio: Buffer.concat(audio), rate, firstAudioMs: first ? first - sent : undefined, transcript }); }
    });
  });
}

const DIALOG = "Hi Emma! How was your weekend? — It was great, thanks. We went to the seaside, and the weather was lovely. What about you? — Oh, I just stayed at home and finally finished that book you gave me.";
const READER = "You are a professional voice actor recording audio for an English listening exercise. Read the user's text aloud exactly as written, word for word, with natural intonation. Do not add, remove or change anything. Do not answer or comment.";

async function speech() {
  const models = ["speech-realtime-max-tts-live/latest", "speech-realtime-deepseek-v4-flash/latest"];
  const urls = (m: string) => [
    `wss://llm.api.cloud.yandex.net/v1/realtime?model=${encodeURIComponent(`gpt://${folder}/${m}`)}`,
    `wss://rest-assistant.api.cloud.yandex.net/v1/realtime?model=${encodeURIComponent(`gpt://${folder}/${m}`)}`,
    `wss://ai.api.cloud.yandex.net/v1/realtime?model=${encodeURIComponent(`gpt://${folder}/${m}`)}`,
  ];
  // найти рабочий адрес
  let base = "";
  for (const u of urls(models[0])) {
    const r = await realtime(u, `gpt://${folder}/${models[0]}`, { instructions: READER, text: DIALOG });
    console.log(`RT ${u.split("?")[0]} → ${r.ok ? "OK" : "FAIL"} ${r.info}`);
    if (r.ok && r.audio) { base = u.split("?")[0]; writeFileSync(`${OUT}/tts-live-default.wav`, wav(r.audio, r.rate ?? 24000)); console.log(`  audio ${(r.audio.length / 2 / (r.rate ?? 24000)).toFixed(1)} s, first audio ${r.firstAudioMs} ms, transcript «${short(r.transcript)}»`); break; }
  }
  if (!base) return;
  // голоса TTS Live: имена OpenAI и Яндекса — какие примет
  for (const voice of ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar", "john", "jane", "alena", "kirill", "dasha", "anton", "lera", "masha"]) {
    const r = await realtime(`${base}?model=${encodeURIComponent(`gpt://${folder}/${models[0]}`)}`, `gpt://${folder}/${models[0]}`, { voice, instructions: READER, text: DIALOG });
    console.log(`VOICE ${voice}: ${r.ok ? `OK ${(r.audio!.length / 2 / (r.rate ?? 24000)).toFixed(1)} s` : "FAIL"} ${r.ok ? "" : r.info}`);
    if (r.ok && r.audio) writeFileSync(`${OUT}/tts-live-${voice}.wav`, wav(r.audio, r.rate ?? 24000));
  }
  // живой собеседник: задержка до первого звука
  for (const m of models) {
    const r = await realtime(`${base}?model=${encodeURIComponent(`gpt://${folder}/${m}`)}`, `gpt://${folder}/${m}`, {
      instructions: "You are a friendly English conversation partner for a B1 student. Keep answers short (1–2 sentences) and ask one follow-up question.",
      text: "Hi! I went to the cinema last weekend with my friends. We watched a film about space.",
    });
    console.log(`TALK ${m}: ${r.ok ? "OK" : "FAIL"} first audio ${r.firstAudioMs ?? "—"} ms · «${short(r.transcript)}» · ${r.info}`);
    if (r.ok && r.audio) writeFileSync(`${OUT}/talk-${m.split("/")[0]}.wav`, wav(r.audio, r.rate ?? 24000));
  }
}

/** Полный ответ session.created (голос по умолчанию, форматы) и проверка «слово в слово» через распознавание речи. */
async function details() {
  const url = `wss://rest-assistant.api.cloud.yandex.net/v1/realtime?model=${encodeURIComponent(`gpt://${folder}/speech-realtime-max-tts-live/latest`)}`;
  const ws = new WebSocket(url, { headers: { Authorization: `Api-Key ${key}`, "OpenAI-Project": folder } });
  await new Promise<void>((res) => {
    const t = setTimeout(() => { ws.close(); res(); }, 15000);
    ws.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.type === "session.created") { console.log("SESSION " + JSON.stringify(m.session)); clearTimeout(t); ws.close(); res(); } });
    ws.on("error", (e) => { console.log("SESSION err " + e.message); clearTimeout(t); res(); });
  });
  // озвучка TTS Live → распознавание: совпадает ли со скриптом
  const r = await realtime(url, `gpt://${folder}/speech-realtime-max-tts-live/latest`, { instructions: READER, text: DIALOG });
  if (r.ok && r.audio) {
    const pcm = r.audio, rate = r.rate ?? 24000;
    // 24 кГц → 16 кГц (линейно)
    const n = Math.floor((pcm.length / 2) * 16000 / rate), out = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) { const x = i * rate / 16000, a = Math.floor(x), f = x - a; const s0 = pcm.readInt16LE(Math.min(a, pcm.length / 2 - 1) * 2), s1 = pcm.readInt16LE(Math.min(a + 1, pcm.length / 2 - 1) * 2); out.writeInt16LE(Math.round(s0 + (s1 - s0) * f), i * 2); }
    const parts: string[] = [];
    for (let i = 0; i < out.length; i += 16000 * 2 * 28) {
      const j = await (await fetch(`https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?folderId=${folder}&lang=en-US&format=lpcm&sampleRateHertz=16000`, { method: "POST", headers: { Authorization: `Api-Key ${key}` }, body: new Uint8Array(out.subarray(i, i + 16000 * 2 * 28)) })).json();
      parts.push(j.result ?? JSON.stringify(j).slice(0, 100));
    }
    console.log("VERBATIM script: " + DIALOG);
    console.log("VERBATIM heard:  " + parts.join(" "));
  }
  // картинки: тот же отказ через OpenAI-совместимый адрес — текст ошибки может быть подробнее
  for (const m of ["yandex-art/latest", "aliceai-art/latest"]) {
    const r2 = await fetch("https://llm.api.cloud.yandex.net/v1/images/generations", { method: "POST", headers: { Authorization: `Api-Key ${key}`, "OpenAI-Project": folder, "Content-Type": "application/json" }, body: JSON.stringify({ model: `art://${folder}/${m}`, prompt: style("apple"), n: 1, size: "1024x1024" }) });
    console.log(`IMG2 ${m}: HTTP ${r2.status} ${short(await r2.text())}`);
  }
}

/** Картинки: правильное имя модели из AI Studio, синхронный OpenAI-совместимый адрес и асинхронный. */
async function images2() {
  const models = ["aliceai-image-art-3.0/latest", "yandex-art/latest", "yandexart-2.0/latest", "yandex-art-2.0/latest"];
  let good: { model: string; how: string } | null = null;
  for (const m of models) {
    for (const prefix of ["art", "gpt"]) {
      const t0 = Date.now();
      try {
        const r = await fetch("https://llm.api.cloud.yandex.net/v1/images/generations", { method: "POST", signal: AbortSignal.timeout(120000), headers: { Authorization: `Api-Key ${key}`, "OpenAI-Project": folder, "Content-Type": "application/json" }, body: JSON.stringify({ model: `${prefix}://${folder}/${m}`, prompt: style("apple"), n: 1, size: "1024x1024", response_format: "b64_json" }) });
        const b = await r.text();
        let img: Buffer | null = null;
        try { const j = JSON.parse(b); const d = j.data?.[0]; if (d?.b64_json) img = Buffer.from(d.b64_json, "base64"); else if (d?.url) img = Buffer.from(await (await fetch(d.url)).arrayBuffer()); } catch {}
        console.log(`IMG3 sync ${prefix}://${m}: HTTP ${r.status} ${img ? `OK ${img.length} bytes ${sec(t0)} s` : short(b)}`);
        if (img) { writeFileSync(`${OUT}/img-${m.split("/")[0]}-apple.png`, img); good = good ?? { model: `${prefix}://${folder}/${m}`, how: "sync" }; }
      } catch (e) { console.log(`IMG3 sync ${prefix}://${m}: ${short((e as Error).message)}`); }
    }
    try { const img = await imageAsync(m, style("apple")); writeFileSync(`${OUT}/img-${m.split("/")[0]}-apple-async.jpg`, img); console.log(`IMG3 async ${m}: OK ${img.length} bytes`); good = good ?? { model: m, how: "async" }; }
    catch (e) { console.log(`IMG3 async ${m}: ${short((e as Error).message)}`); }
  }
  if (!good) return;
  // остальные слова — рабочим способом
  for (const w of WORDS.slice(1)) {
    const t0 = Date.now();
    try {
      let img: Buffer;
      if (good.how === "async") img = await imageAsync(good.model, style(w));
      else {
        const r = await fetch("https://llm.api.cloud.yandex.net/v1/images/generations", { method: "POST", signal: AbortSignal.timeout(120000), headers: { Authorization: `Api-Key ${key}`, "OpenAI-Project": folder, "Content-Type": "application/json" }, body: JSON.stringify({ model: good.model, prompt: style(w), n: 1, size: "1024x1024", response_format: "b64_json" }) });
        const j = await r.json(); const d = j.data?.[0];
        img = d?.b64_json ? Buffer.from(d.b64_json, "base64") : Buffer.from(await (await fetch(d.url)).arrayBuffer());
      }
      writeFileSync(`${OUT}/img-final-${w.replace(/\s+/g, "_")}.png`, img);
      console.log(`IMG3 word «${w}»: OK ${sec(t0)} s`);
    } catch (e) { console.log(`IMG3 word «${w}»: ${short((e as Error).message)}`); }
  }
}

export async function run() {
  if (process.argv[3] === "images") { rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true }); await images2(); return; }
  if (process.argv[3] === "details") { await details(); return; }
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
  console.log(`PROBE2 folder set: ${!!folder}, key set: ${!!key}`);
  await images().catch((e) => console.log("IMG crash", short(e.message)));
  await speech().catch((e) => console.log("RT crash", short(e.message)));
  console.log("PROBE2 done");
}
