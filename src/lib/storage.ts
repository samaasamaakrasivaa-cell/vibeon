import "server-only";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomToken } from "./auth/crypto";

// Хранилище файлов. Сейчас — локальная папка (в Docker это том `uploads`).
// S3 (TimeWeb / Yandex Object Storage) подключается на этапе 11 через STORAGE_DRIVER=s3.
const ROOT = path.resolve(process.env.UPLOAD_DIR || "./uploads");

export const MAX_UPLOAD = 50 * 1024 * 1024; // 50 МБ — совпадает с client_max_body_size в nginx
const ALLOWED = /^(image\/(png|jpe?g|gif|webp|svg\+xml|heic)|audio\/(mpeg|mp3|mp4|ogg|wav|webm|x-m4a|aac)|video\/(mp4|webm|quicktime)|application\/pdf)$/;

export const allowedMime = (m: string) => ALLOWED.test(m);

export async function saveFile(buf: Buffer, mime: string) {
  const ext = mime.split("/")[1].replace("svg+xml", "svg").replace("jpeg", "jpg").replace("quicktime", "mov").replace("mpeg", "mp3").replace("x-m4a", "m4a");
  const d = new Date();
  const key = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomToken(18)}.${ext}`;
  const full = path.join(ROOT, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
  return key;
}

export async function readStored(key: string) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) return null; // защита от ../
  try {
    const st = await stat(full);
    return { buf: await readFile(full), size: st.size };
  } catch {
    return null;
  }
}

export const fileUrl = (key: string) => `/api/files/${key}`;
