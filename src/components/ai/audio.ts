"use client";
// Запись голоса и озвучка. Браузер сам переводит запись в WAV 16 кГц моно — такой формат принимает SpeechKit.

export async function toWav16k(blob: Blob): Promise<Blob> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctx();
  const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
  await ac.close();
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const off = new OfflineAudioContext(1, frames, 16000);
  const src = off.createBufferSource();
  src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

/** Запись → текст. Ошибка — код ИИ-шлюза (limit / tariff / off / fail). */
export async function transcribe(blob: Blob, lang: "en-US" | "ru-RU" = "en-US"): Promise<string> {
  const fd = new FormData();
  fd.append("audio", await toWav16k(blob), "speech.wav");
  fd.append("lang", lang);
  const r = await fetch("/api/ai/stt", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "fail");
  return j.text as string;
}

let current: HTMLAudioElement | null = null;
/** Озвучить: голос SpeechKit, если он подключён, иначе — голос браузера. */
export async function say(text: string, lang: "en-US" | "ru-RU" = "en-US") {
  current?.pause();
  if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
  try {
    const r = await fetch("/api/ai/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang }) });
    if (r.status === 200) { current = new Audio(URL.createObjectURL(await r.blob())); await current.play(); return; }
  } catch { /* озвучит браузер */ }
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "ru-RU" ? "ru-RU" : "en-GB"; u.rate = 0.95;
  speechSynthesis.speak(u);
}

/** Простой рекордер: start() → stop() возвращает запись. */
export function makeRecorder() {
  let rec: MediaRecorder | null = null, chunks: Blob[] = [], stream: MediaStream | null = null;
  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream); chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start();
    },
    stop(): Promise<Blob> {
      return new Promise((res) => {
        if (!rec) return res(new Blob());
        rec.onstop = () => { stream?.getTracks().forEach((x) => x.stop()); res(new Blob(chunks, { type: rec!.mimeType })); };
        rec.stop();
      });
    },
  };
}
