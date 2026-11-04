import "server-only";
import { randomUUID } from "node:crypto";

// Провайдеры ИИ. Ключи — только в .env на сервере; в браузер ничего не уходит.
//   mock               — ответы-заглушки для разработки (без сети)
//   yandex             — YandexGPT (текст), Vision OCR (фото, PDF), SpeechKit (речь)
//   gigachat           — GigaChat (текст); речь и OCR — через Yandex, если заданы его ключи
//   anthropic_gateway  — Claude через промежуточный сервер (AI_GATEWAY_URL), формат Messages API

export type Provider = "mock" | "yandex" | "gigachat" | "anthropic_gateway";
export type ChatMsg = { role: "user" | "assistant"; text: string };
export type ChatReq = { system: string; messages: ChatMsg[]; strong?: boolean; json?: boolean; maxTokens?: number; temperature?: number };
export type ChatRes = { text: string; model: string; tokensIn: number; tokensOut: number };

export const provider = (): Provider => {
  const p = (process.env.AI_PROVIDER || "mock").toLowerCase();
  return p === "yandex" || p === "gigachat" || p === "anthropic_gateway" ? p : "mock";
};

const Y = () => ({ folder: process.env.YANDEX_CLOUD_FOLDER_ID || "", key: process.env.YANDEX_CLOUD_API_KEY || "" });
export const yandexReady = () => !!(Y().folder && Y().key);
const yHeaders = () => ({ Authorization: `Api-Key ${Y().key}`, "x-folder-id": Y().folder });

async function fetchJson(url: string, init: RequestInit, timeoutMs = 60000) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await r.text();
  if (!r.ok) throw new Error(`AI HTTP ${r.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

// ───────── Текст ─────────

async function yandexChat(q: ChatReq): Promise<ChatRes> {
  const model = q.strong ? process.env.AI_MODEL_STRONG || "yandexgpt/latest" : process.env.AI_MODEL_FAST || "yandexgpt-lite/latest";
  const j = await fetchJson("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
    method: "POST",
    headers: { ...yHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      modelUri: `gpt://${Y().folder}/${model}`,
      completionOptions: { stream: false, temperature: q.temperature ?? 0.3, maxTokens: String(q.maxTokens ?? 2000) },
      messages: [{ role: "system", text: q.system }, ...q.messages.map((m) => ({ role: m.role, text: m.text }))],
    }),
  });
  const u = j.result?.usage ?? {};
  return { text: j.result?.alternatives?.[0]?.message?.text ?? "", model, tokensIn: Number(u.inputTextTokens ?? 0), tokensOut: Number(u.completionTokens ?? 0) };
}

let giga: { token: string; until: number } | null = null;
async function gigaToken() {
  if (giga && giga.until > Date.now() + 60000) return giga.token;
  const j = await fetchJson("https://ngw.devices.sberbank.ru:9443/api/v2/oauth", {
    method: "POST",
    headers: { Authorization: `Basic ${process.env.GIGACHAT_AUTH_KEY}`, RqUID: randomUUID(), "Content-Type": "application/x-www-form-urlencoded" },
    body: `scope=${process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS"}`,
  });
  giga = { token: j.access_token, until: Number(j.expires_at) };
  return giga.token;
}
async function gigaChat(q: ChatReq): Promise<ChatRes> {
  const model = q.strong ? process.env.AI_MODEL_STRONG || "GigaChat-Pro" : process.env.AI_MODEL_FAST || "GigaChat";
  const j = await fetchJson("https://gigachat.devices.sberbank.ru/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${await gigaToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: q.temperature ?? 0.3, max_tokens: q.maxTokens ?? 2000, messages: [{ role: "system", content: q.system }, ...q.messages.map((m) => ({ role: m.role, content: m.text }))] }),
  });
  return { text: j.choices?.[0]?.message?.content ?? "", model, tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 };
}

async function anthropicChat(q: ChatReq): Promise<ChatRes> {
  const base = (process.env.AI_GATEWAY_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("AI_GATEWAY_URL is empty");
  const model = q.strong ? process.env.AI_MODEL_STRONG || "claude-sonnet-5-5" : process.env.AI_MODEL_FAST || "claude-haiku-5-5";
  const j = await fetchJson(`${base}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": process.env.AI_GATEWAY_KEY || "", "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: q.maxTokens ?? 2000, temperature: q.temperature ?? 0.3, system: q.system, messages: q.messages.map((m) => ({ role: m.role, content: m.text })) }),
  });
  const text = (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  return { text, model, tokensIn: j.usage?.input_tokens ?? 0, tokensOut: j.usage?.output_tokens ?? 0 };
}

export async function chat(q: ChatReq): Promise<ChatRes> {
  const p = provider();
  if (p === "yandex") return yandexChat(q);
  if (p === "gigachat") return gigaChat(q);
  if (p === "anthropic_gateway") return anthropicChat(q);
  throw new Error("mock provider has no chat");
}

// ───────── Речь и распознавание (Yandex SpeechKit, Vision OCR) ─────────

/** Распознавание речи. На входе — WAV 16 кГц моно (браузер готовит его сам). SpeechKit v1 берёт до 30 с за раз — режем на куски. */
export async function yandexStt(pcm: Buffer, lang: string) {
  const CHUNK = 16000 * 2 * 28;
  const parts: string[] = [];
  for (let i = 0; i < pcm.length; i += CHUNK) {
    const j = await fetchJson(`https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?folderId=${Y().folder}&lang=${lang}&format=lpcm&sampleRateHertz=16000`, {
      method: "POST", headers: { Authorization: `Api-Key ${Y().key}` }, body: new Uint8Array(pcm.subarray(i, i + CHUNK)),
    });
    if (j.result) parts.push(j.result);
  }
  return parts.join(" ");
}

export async function yandexTts(text: string, lang: string) {
  const r = await fetch("https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize", {
    method: "POST",
    headers: { Authorization: `Api-Key ${Y().key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text: text.slice(0, 4900), lang, voice: lang.startsWith("ru") ? "alena" : process.env.YANDEX_TTS_VOICE || "john", format: "mp3", folderId: Y().folder }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`TTS HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function yandexOcr(buf: Buffer, mime: string) {
  const mimeType = mime.includes("png") ? "PNG" : mime.includes("pdf") ? "PDF" : "JPEG";
  const j = await fetchJson("https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText", {
    method: "POST",
    headers: { ...yHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ mimeType, languageCodes: ["en", "ru"], model: "page", content: buf.toString("base64") }),
  });
  return (j.result?.textAnnotation?.fullText as string) ?? "";
}
