import "server-only";
import { inflateRawSync } from "node:zlib";
import { ocr, type Ctx } from "./gateway";

/** Файлы из ZIP-архива (docx, pptx) — без сторонних библиотек: по центральному каталогу. */
function unzip(buf: Buffer, want: (name: string) => boolean) {
  const out: Record<string, Buffer> = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString();
    if (want(name)) {
      const lstart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.subarray(lstart, lstart + csize);
      out[name] = method === 8 ? inflateRawSync(data) : data;
    }
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const xmlText = (x: string) => x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function docx(buf: Buffer) {
  const f = unzip(buf, (n) => n === "word/document.xml")["word/document.xml"];
  if (!f) return "";
  return xmlText(f.toString("utf8")
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
}

function pptx(buf: Buffer) {
  const files = unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  return Object.keys(files).sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()))
    .map((k) => xmlText(files[k].toString("utf8").replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, "")).trim()).join("\n\n");
}

async function pdf(buf: Buffer) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(doc, { mergePages: false });
  return (text as string[]).map((p) => p.trim()).join("\n\n");
}

export const EXTRACT_MAX = 30 * 1024 * 1024;
export const extractable = (name: string, mime: string) =>
  /\.(docx|pptx|pdf|txt|md|png|jpe?g|webp)$/i.test(name) || /^(text\/|image\/(png|jpe?g|webp)|application\/pdf)/.test(mime);

/** Текст из файла. Сканы и фото — через распознавание (OCR) шлюза. */
export async function extractText(buf: Buffer, name: string, mime: string, ctx: Ctx): Promise<{ text: string; ocr: boolean }> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx") return { text: docx(buf), ocr: false };
  if (ext === "pptx") return { text: pptx(buf), ocr: false };
  if (ext === "txt" || ext === "md" || mime.startsWith("text/")) return { text: buf.toString("utf8").replace(/^﻿/, ""), ocr: false };
  if (ext === "pdf" || mime === "application/pdf") {
    const text = await pdf(buf).catch(() => "");
    if (text.replace(/\s/g, "").length > 40) return { text, ocr: false };
    return { text: await ocr(buf, "application/pdf", ctx), ocr: true }; // скан без текстового слоя
  }
  if (mime.startsWith("image/") || /^(png|jpe?g|webp)$/.test(ext)) return { text: await ocr(buf, mime || `image/${ext}`, ctx), ocr: true };
  return { text: "", ocr: false };
}
