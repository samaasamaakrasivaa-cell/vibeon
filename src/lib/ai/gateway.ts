import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { chat, provider, yandexOcr, yandexReady, yandexStt, yandexTts } from "./providers";
import { SPECS, type Kind, type SpecIn, type SpecOut } from "./tasks";

// ИИ-шлюз: все функции платформы обращаются к ИИ только через него.
// Здесь — лимиты по тарифу, удаление личных данных из текста, кэш общих результатов и учёт вызовов.

export class AiError extends Error {
  constructor(public code: "limit" | "tariff" | "off" | "fail", msg?: string) { super(msg ?? code); }
}
export type Ctx = { userId: string; teacherId: string | null; names?: (string | null | undefined)[] };

/** На тарифе «Старт» нет ИИ-проверки и ИИ-собеседника (Решения_и_доступы.md). Пробный период — как «Профи». */
const PRO_ONLY: Kind[] = ["essay", "precheck", "partner"];
const CACHED: Kind[] = ["file", "split", "book"];

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

export async function usage(teacherId: string) {
  const used = await db.aiCall.count({ where: { teacherId, createdAt: { gte: monthStart() }, cached: false, ok: true } });
  const limit = Number(process.env.AI_MONTHLY_LIMIT_PER_TEACHER || 0) || null;
  return { used, limit };
}

async function guard(kind: Kind | "stt" | "tts" | "ocr", ctx: Ctx) {
  if (!ctx.teacherId) return;
  const prof = await db.teacherProfile.findUnique({ where: { userId: ctx.teacherId }, select: { tariff: true } });
  if (prof?.tariff === "START" && (PRO_ONLY as string[]).includes(kind)) throw new AiError("tariff");
  const { used, limit } = await usage(ctx.teacherId);
  if (limit && used >= limit) throw new AiError("limit");
}

/** Личные данные в ИИ не уходят: почта, телефоны и имена заменяются (152-ФЗ). */
export function scrub(text: string, names: (string | null | undefined)[] = []) {
  let s = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, "[телефон]");
  for (const n of names) if (n && n.length > 1) s = s.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "[имя]");
  return s;
}

const log = (kind: string, ctx: Ctx, data: Partial<Prisma.AiCallUncheckedCreateInput>) =>
  db.aiCall.create({ data: { kind, provider: provider(), teacherId: ctx.teacherId, userId: ctx.userId, ...data } }).catch(() => undefined);

export async function run<K extends Kind>(kind: K, input: SpecIn<K>, ctx: Ctx): Promise<SpecOut<K>> {
  await guard(kind, ctx);
  const spec = SPECS[kind] as unknown as {
    strong?: boolean; json?: boolean; maxTokens?: number; temperature?: number;
    system: (i: SpecIn<K>) => string; user: (i: SpecIn<K>) => { role: "user" | "assistant"; text: string }[];
    parse: (t: string, i: SpecIn<K>) => SpecOut<K>; mock: (i: SpecIn<K>) => SpecOut<K>;
  };
  const key = CACHED.includes(kind) ? createHash("sha256").update(kind + provider() + JSON.stringify(input)).digest("hex") : null;
  if (key) {
    const hit = await db.aiCache.findUnique({ where: { key } });
    if (hit) { await log(kind, ctx, { cached: true }); return hit.value as SpecOut<K>; }
  }
  const t0 = Date.now();
  let out: SpecOut<K>;
  try {
    if (provider() === "mock") {
      await new Promise((r) => setTimeout(r, 150));
      out = spec.mock(input);
      await log(kind, ctx, { model: "mock", ms: Date.now() - t0 });
    } else {
      const res = await chat({
        system: spec.system(input), strong: spec.strong, json: spec.json, maxTokens: spec.maxTokens, temperature: spec.temperature,
        messages: spec.user(input).map((m) => ({ role: m.role, text: scrub(m.text, ctx.names) })),
      });
      out = spec.parse(res.text, input);
      await log(kind, ctx, { model: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, ms: Date.now() - t0 });
    }
  } catch (e) {
    await log(kind, ctx, { ok: false, ms: Date.now() - t0 });
    console.error(`[ai:${kind}]`, e);
    throw e instanceof AiError ? e : new AiError("fail", String((e as Error).message));
  }
  if (key) await db.aiCache.upsert({ where: { key }, create: { key, value: out as Prisma.InputJsonValue }, update: { value: out as Prisma.InputJsonValue } }).catch(() => undefined);
  return out;
}

// ───────── Речь и распознавание ─────────

type Speech = "yandex" | "mock" | null;
const speech = (): Speech => (yandexReady() ? "yandex" : provider() === "mock" ? "mock" : null);
export const speechServer = () => speech() === "yandex";

/** WAV (16 кГц, моно, 16 бит) → PCM без заголовка. */
function pcmOf(wav: Buffer) {
  if (wav.subarray(0, 4).toString() !== "RIFF") return wav;
  let p = 12;
  while (p + 8 <= wav.length) { const id = wav.subarray(p, p + 4).toString(), size = wav.readUInt32LE(p + 4); if (id === "data") return wav.subarray(p + 8, p + 8 + size); p += 8 + size; }
  return wav.subarray(44);
}

export async function stt(wav: Buffer, lang: "en-US" | "ru-RU", ctx: Ctx) {
  await guard("stt", ctx);
  const s = speech();
  if (!s) throw new AiError("off");
  const pcm = pcmOf(wav), t0 = Date.now();
  if (s === "mock") {
    const sec = pcm.length / 32000;
    await log("stt", ctx, { model: "mock", ms: 0 });
    if (lang === "ru-RU") return "Ученик хорошо говорит, но путает времена. Повторить Present Perfect.";
    return sec < 4 ? "I think it is a good idea." : "I think learning English is realy useful becouse i can travel and talk with people from other countries. Last year I go to London and i didn't understood everything.";
  }
  try { const text = await yandexStt(pcm, lang); await log("stt", ctx, { model: "speechkit", ms: Date.now() - t0 }); return text; }
  catch (e) { await log("stt", ctx, { ok: false }); console.error("[ai:stt]", e); throw new AiError("fail"); }
}

/** Озвучка. null — серверной озвучки нет, браузер озвучит сам (speechSynthesis). */
export async function tts(text: string, lang: "en-US" | "ru-RU", ctx: Ctx) {
  if (speech() !== "yandex") return null;
  await guard("tts", ctx);
  try { const b = await yandexTts(text, lang); await log("tts", ctx, { model: "speechkit" }); return b; }
  catch (e) { await log("tts", ctx, { ok: false }); console.error("[ai:tts]", e); return null; }
}

/** Текст с картинки или PDF-скана. Заглушка читает подпись PNG (tEXt «Description») — для тестов. */
export async function ocr(buf: Buffer, mime: string, ctx: Ctx) {
  const s = speech();
  if (!s) throw new AiError("off");
  if (s === "mock") {
    await log("ocr", ctx, { model: "mock" });
    if (!mime.includes("png")) return "";
    let p = 8;
    while (p + 8 < buf.length) {
      const len = buf.readUInt32BE(p), type = buf.subarray(p + 4, p + 8).toString();
      if (type === "tEXt") { const [k, v] = buf.subarray(p + 8, p + 8 + len).toString("latin1").split("\0"); if (/description|comment/i.test(k)) return Buffer.from(v, "latin1").toString("utf8"); }
      if (type === "IEND") break;
      p += 12 + len;
    }
    return "";
  }
  await guard("ocr", ctx);
  try { const text = await yandexOcr(buf, mime); await log("ocr", ctx, { model: "vision" }); return text; }
  catch (e) { await log("ocr", ctx, { ok: false }); console.error("[ai:ocr]", e); throw new AiError("fail"); }
}
