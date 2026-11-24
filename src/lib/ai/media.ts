"use server";
// Конструктор: картинки ИИ для «Слово к картинке» (с библиотекой — одно слово рисуется один раз) и озвучка скрипта для аудирования.
import { requireUser } from "../auth/session";
import { db } from "../db";
import { getT } from "../i18n/server";
import { fileUrl, saveFile } from "../storage";
import { aiCtx, aiCode } from "./ctx";
import { aiCall } from "./gateway";
import { prompt } from "./prompts";
import { speechkitV3, studioImage } from "./providers";
import { parseScript, joinMp3, mockWav } from "./tts-script";

type Ok<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Сохранить файл и зарегистрировать его (без записи в Upload ссылка /api/files/… не открывается). */
async function store(ownerId: string, buf: Buffer, mime: string, name: string) {
  const key = await saveFile(buf, mime);
  await db.upload.create({ data: { ownerId, path: key, name: name.slice(0, 200), mime, size: buf.length } });
  return fileUrl(key);
}

const IMAGE_MODEL = () => process.env.AI_MODEL_IMAGE || "aliceai-image-art-3.0/latest";
const IMAGE_STYLE = () => process.env.AI_IMAGE_STYLE || "flat";
const norm = (w: string) => w.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);

/** Заглушка для разработки (без ключей): простая картинка с подписью. */
const mockSvg = (w: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#f4f6fb"/><circle cx="256" cy="220" r="120" fill="#ffb3a7"/><text x="256" y="430" font-size="44" text-anchor="middle" font-family="sans-serif" fill="#333">${w.replace(/[<&>"]/g, "")}</text></svg>`);

/** Картинка к слову: из библиотеки (если есть и не просили новую) или новая от ИИ — и тогда в библиотеку. */
export async function pictureFor(word: string, fresh = false, skip: string[] = []): Promise<Ok<{ url: string; fromLib: boolean }>> {
  const me = await requireUser("TEACHER");
  const { t } = await getT();
  const w = norm(word);
  if (!w) return { ok: false, error: t("ai.err.fail") };
  const style = IMAGE_STYLE();
  if (!fresh) {
    // библиотека: последняя картинка этого слова в текущем стиле, кроме тех, что уже отклонили
    const hit = await db.aiImage.findFirst({ where: { word: w, style, url: { notIn: skip } }, orderBy: { createdAt: "desc" } });
    if (hit) return { ok: true, url: hit.url, fromLib: true };
  }
  try {
    const model = IMAGE_MODEL();
    const isMock = { v: false };
    const buf = await aiCall("image", await aiCtx(me), model, () => studioImage(model, prompt("image").replace(/\{word\}/g, w)), () => { isMock.v = true; return mockSvg(w); });
    const url = await store(me.id, buf, isMock.v ? "image/svg+xml" : "image/png", `${w}.${isMock.v ? "svg" : "png"}`);
    await db.aiImage.create({ data: { word: w, style, model: isMock.v ? "mock" : model, url, teacherId: me.id } });
    return { ok: true, url, fromLib: false };
  } catch (e) { return { ok: false, error: t(`ai.err.${aiCode(e)}`) }; }
}

/** Озвучка скрипта аудирования: реплики «Имя: текст» — разные собеседники (второй — выше тоном), паузы между репликами. */
export async function voiceScript(script: string, opts: { speed?: number; pause?: number }): Promise<Ok<{ url: string; seconds: number; speakers: number }>> {
  const me = await requireUser("TEACHER");
  const { t } = await getT();
  const parts = parseScript(script);
  if (!parts.length) return { ok: false, error: t("tts.err.empty") };
  if (parts.reduce((a, p) => a + p.text.length, 0) > 8000) return { ok: false, error: t("tts.err.long") };
  const speed = Math.min(1.3, Math.max(0.7, Number(opts.speed) || 1));
  const pause = Math.min(2000, Math.max(200, Math.round(Number(opts.pause) || 600)));
  const voice = process.env.TTS_EN_VOICE || "john";
  // одна и та же голосовая модель — собеседники различаются высотой тона
  const PITCH = [0, 160, -110, 240];
  try {
    let isMock = false;
    const out = await aiCall("tts-script", await aiCtx(me), `speechkit-v3:${voice}`, async () => {
      const chunks: Buffer[] = [];
      for (const p of parts) chunks.push(await speechkitV3(p.text, { voice, speed, pitchShift: PITCH[p.speaker % PITCH.length] }));
      return joinMp3(chunks, pause);
    }, () => { isMock = true; return mockWav(parts.reduce((a, p) => a + p.text.length, 0) / 14); });
    const url = await store(me.id, out, isMock ? "audio/wav" : "audio/mpeg", isMock ? "listening.wav" : "listening.mp3");
    // длительность: SpeechKit отдаёт mp3 64 кбит/с (8000 байт/с) — для подсказки учителю
    const seconds = isMock ? Math.round(parts.reduce((a, p) => a + p.text.length, 0) / 14) : Math.round(out.length / 8000);
    return { ok: true, url, seconds, speakers: new Set(parts.map((p) => p.speaker)).size };
  } catch (e) { return { ok: false, error: t(`ai.err.${aiCode(e)}`) }; }
}
