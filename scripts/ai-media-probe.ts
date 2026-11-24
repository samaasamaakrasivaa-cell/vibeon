// Проба на сервере: озвучка диалога голосом John (тишина между репликами вставляется кадрами mp3, второй собеседник — другим тоном) и картинки к словам.
// Тестовый текст, данные платформы не используются. Файлы — в /tmp/aiout (выкладка публикует их в ветку ai-probe-out).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { speechkitV3, studioImage } from "../src/lib/ai/providers";
import { parseScript, joinMp3 } from "../src/lib/ai/tts-script";
import { readFileSync } from "node:fs";
import path from "node:path";

const OUT = "/tmp/aiout";
const DIALOG = `Anna: Hi, Tom! How was your weekend?
Tom: Oh, it was great, thanks. I went hiking in the mountains with my brother.
Anna: That sounds amazing! Was it cold up there?
Tom: A little bit, but the views were absolutely worth it. What about you?
Anna: I just stayed at home and finished a really good book.`;

export async function run() {
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
  const PITCH = [0, 160, -110, 240];
  const parts = parseScript(DIALOG);
  for (const [name, speed, pause] of [["dialog-0.95-600", 0.95, 600], ["dialog-0.85-1000", 0.85, 1000]] as const) {
    const t0 = Date.now();
    const chunks: Buffer[] = [];
    for (const p of parts) chunks.push(await speechkitV3(p.text, { voice: process.env.TTS_EN_VOICE || "john", speed, pitchShift: PITCH[p.speaker % PITCH.length] }));
    const mp3 = joinMp3(chunks, pause);
    writeFileSync(path.join(OUT, `${name}.mp3`), mp3);
    console.log(`${name}: ${parts.length} реплик, ${mp3.length} байт, ~${Math.round(mp3.length / 8000)} с, ${Date.now() - t0} мс`);
  }
  const tpl = readFileSync(path.join(process.cwd(), "prompts", "image.md"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).join(" ").trim();
  for (const w of ["umbrella", "to swim"]) {
    const t0 = Date.now();
    const png = await studioImage(process.env.AI_MODEL_IMAGE || "aliceai-image-art-3.0/latest", tpl.replace(/\{word\}/g, w));
    writeFileSync(path.join(OUT, `pic-${w.replace(/\s+/g, "-")}.png`), png);
    console.log(`картинка «${w}»: ${png.length} байт, ${Date.now() - t0} мс`);
  }
}
