import "server-only";
import http from "node:http";
import { MAX_PAYMENT_FILE } from "./payment-upload-body";

const pdf = "application/pdf";
const imageTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const MAX_OCR_FILE = 7 * 1024 ** 2;
const MAX_ENVELOPE = 1024;
const MAX_PAGES = 20;

export function paymentDocumentExtension(mime: string) {
  if (mime === pdf) return "pdf";
  return Object.hasOwn(imageTypes, mime) ? imageTypes[mime as keyof typeof imageTypes] : null;
}

type Invalid = { error: "size" | "type" | "pixels" | "pages" | "expanded" | "busy" };
export type CheckedDocument = { buf: Buffer; mime: string; pages: number; ocr?: { buf: Buffer; mime: string } };

export function inspectPaymentDocument(buf: Buffer, declaredMime: string): Promise<Invalid | CheckedDocument> {
  if (!buf.length || buf.length > MAX_PAYMENT_FILE) return Promise.resolve({ error: "size" });
  return new Promise((resolve) => {
    const req = http.request({
      socketPath: process.env.PAYMENT_VALIDATOR_SOCKET || "/run/payment-validator/worker.sock",
      path: "/validate", method: "POST", headers: { "Content-Type": declaredMime || "application/octet-stream", "Content-Length": buf.length },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve({ error: "busy" });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (part: Buffer) => {
        size += part.length;
        if (size > MAX_PAYMENT_FILE + MAX_OCR_FILE + MAX_ENVELOPE) {
          res.destroy();
          resolve({ error: "busy" });
          return;
        }
        chunks.push(part);
      });
      res.on("error", () => resolve({ error: "busy" }));
      res.on("aborted", () => resolve({ error: "busy" }));
      res.on("end", () => {
        try {
          const bytes = Buffer.concat(chunks, size);
          const line = bytes.indexOf(10);
          if (line < 0 || line >= MAX_ENVELOPE) throw new Error();
          const meta = JSON.parse(bytes.toString("utf8", 0, line));
          if (["size", "type", "pixels", "pages", "expanded"].includes(meta.error)) {
            resolve({ error: meta.error });
            return;
          }
          if (!paymentDocumentExtension(meta.mime) || !Number.isInteger(meta.pages) ||
              meta.pages < 1 || meta.pages > MAX_PAGES || !Number.isInteger(meta.size) ||
              meta.size < 1 || meta.size > MAX_PAYMENT_FILE || !Number.isInteger(meta.ocrSize) ||
              meta.ocrSize < 0 || meta.ocrSize > MAX_OCR_FILE || size !== line + 1 + meta.size + meta.ocrSize ||
              (meta.ocrSize && (meta.pages !== 1 || !["image/jpeg", "image/png", pdf].includes(meta.ocrMime)))) throw new Error();
          const start = line + 1;
          const end = start + meta.size;
          resolve({ buf: bytes.subarray(start, end), mime: meta.mime, pages: meta.pages,
            ocr: meta.ocrSize ? { buf: bytes.subarray(end), mime: meta.ocrMime } : undefined });
        } catch {
          resolve({ error: "busy" });
        }
      });
    });
    req.setTimeout(6000, () => req.destroy());
    req.on("error", () => resolve({ error: "busy" }));
    req.end(buf);
  });
}
