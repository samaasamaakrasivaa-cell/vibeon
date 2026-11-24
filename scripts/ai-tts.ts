// Проба озвучки (deploy → aidemo tts): какие голоса SpeechKit говорят по-английски; каждый озвучивает один и тот же диалог.
// Аудио печатается в лог кусками base64 — для прослушивания. Данные платформы не используются.
const folder = process.env.YANDEX_CLOUD_FOLDER_ID || "", key = process.env.YANDEX_CLOUD_API_KEY || "";
const LINES = ["Hi Emma! How was your weekend?", "It was great, thanks. We went to the seaside, and the weather was lovely. What about you?", "Oh, I just stayed at home and finally finished that book you gave me."];
const TEXT = LINES.join(" ");

function dump(name: string, buf: Buffer) {
  const b = buf.toString("base64"), n = Math.ceil(b.length / 3500);
  for (let i = 0; i < n; i++) console.log(`MP3 ${name} ${i + 1}/${n} ${b.slice(i * 3500, (i + 1) * 3500)}`);
}

async function v3(voice: string, extra: Record<string, unknown> = {}, text = TEXT) {
  const r = await fetch("https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis", {
    method: "POST", headers: { Authorization: `Api-Key ${key}`, "x-folder-id": folder, "Content-Type": "application/json" },
    body: JSON.stringify({ text, hints: [{ voice }, ...(extra.hints as object[] ?? [])], outputAudioSpec: { containerAudio: { containerAudioType: "MP3" } }, loudnessNormalizationType: "LUFS", ...(extra.body as object ?? {}) }),
    signal: AbortSignal.timeout(60000),
  });
  const t = await r.text();
  if (!r.ok) return { ok: false as const, err: `HTTP ${r.status} ${t.replace(/\s+/g, " ").slice(0, 160)}` };
  const parts: Buffer[] = [];
  for (const line of t.split("\n")) { if (!line.trim()) continue; try { const j = JSON.parse(line); const d = j.result?.audioChunk?.data; if (d) parts.push(Buffer.from(d, "base64")); } catch {} }
  return parts.length ? { ok: true as const, buf: Buffer.concat(parts) } : { ok: false as const, err: `no audio ${t.slice(0, 160)}` };
}

async function v1(voice: string) {
  const r = await fetch("https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize", {
    method: "POST", headers: { Authorization: `Api-Key ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text: TEXT, lang: "en-US", voice, format: "mp3", folderId: folder }), signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) return { ok: false as const, err: `HTTP ${r.status} ${(await r.text()).slice(0, 160)}` };
  return { ok: true as const, buf: Buffer.from(await r.arrayBuffer()) };
}

export async function run() {
  // кандидаты: английские и мультиязычные голоса SpeechKit (неподходящие вернут ошибку — это нормально)
  const voices = ["john", "jane", "lea", "naomi", "alena", "filipp", "ermil", "jane", "omazh", "zahar", "dasha", "julia", "lera", "masha", "marina", "alexander", "kirill", "anton", "madi_ru", "saule_ru", "zamira_ru", "zhanar_ru", "yulduz_ru"];
  const ok: string[] = [];
  for (const v of [...new Set(voices)]) {
    const r = await v3(v);
    console.log(`V3 ${v}: ${r.ok ? `OK ${r.buf.length} bytes` : r.err}`);
    if (r.ok) { ok.push(v); if (["john", "jane", "lea", "naomi", "alena", "filipp", "dasha", "kirill"].includes(v)) dump(`v3-${v}`, r.buf); }
  }
  const r1 = await v1("john");
  console.log(`V1 john: ${r1.ok ? `OK ${r1.buf.length} bytes` : r1.err}`);
  if (r1.ok) dump("v1-john", r1.buf);
  // роли и скорость у john (если поддерживаются)
  for (const role of ["neutral", "good", "strict", "friendly", "whisper"]) {
    const r = await v3("john", { hints: [{ role }] }, LINES[0]);
    console.log(`V3 john role=${role}: ${r.ok ? "OK" : r.err}`);
  }
  console.log(`TTS voices OK: ${ok.join(", ")}`);
}
