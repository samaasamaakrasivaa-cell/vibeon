import "server-only";
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { randomToken } from "../auth/crypto";
import { MAX_PAYMENT_FILE } from "./payment-upload-body";
import { type CheckedDocument, paymentDocumentExtension } from "./document-content";

const root = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const blob = z.object({
  key: z.string().regex(/^payment\/[A-Za-z0-9_-]{24}\.[a-z]+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  fingerprint: z.string(),
  size: z.number().int().min(1).max(MAX_PAYMENT_FILE),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
});
const ocrBlob = blob.extend({
  size: z.number().int().min(1).max(7 * 1024 ** 2),
  mime: z.enum(["image/jpeg", "image/png", "application/pdf"]),
});
const snapshot = z.object({ version: z.literal(1), document: blob, pages: z.number().int().min(1).max(20), ocr: ocrBlob.optional() })
  .refine((item) => !item.ocr || item.pages === 1);

export type PaymentArtifact = z.infer<typeof snapshot>;
type Blob = z.infer<typeof blob>;

export function paymentArtifact(value: unknown) {
  const parsed = snapshot.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// Record the physical identity for metadata-only HEAD. Digests survive backups
// which preserve the bytes but change the file's inode and change time.
const fingerprint = (info: BigIntStats) => [info.dev, info.ino, info.ctimeNs, info.mtimeNs].join("/");

export async function removePaymentArtifact(artifact: PaymentArtifact) {
  await Promise.all([artifact.document, artifact.ocr].map(async (item) => {
    if (item) await unlink(path.join(root, item.key)).catch(() => undefined);
  }));
}

export async function persistPaymentArtifact(checked: CheckedDocument): Promise<PaymentArtifact> {
  await mkdir(path.join(root, "payment"), { recursive: true, mode: 0o700 });
  const owned: string[] = [];
  async function save(buf: Buffer, mime: string) {
    const key = `payment/${randomToken(18)}.${paymentDocumentExtension(mime)}`;
    const file = path.join(root, key);
    const fd = await open(file, "wx", 0o440);
    owned.push(file);
    try {
      await fd.writeFile(buf);
      await fd.sync();
      return blob.parse({ key, mime, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex"),
        fingerprint: fingerprint(await fd.stat({ bigint: true })) });
    } finally {
      await fd.close();
    }
  }
  try {
    const document = await save(checked.buf, checked.mime);
    const ocr = checked.ocr ? await save(checked.ocr.buf, checked.ocr.mime) : undefined;
    const directory = await open(path.join(root, "payment"), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return snapshot.parse({ version: 1, document, pages: checked.pages, ocr });
  } catch (error) {
    await Promise.all(owned.map((file) => unlink(file).catch(() => undefined)));
    throw error;
  }
}

async function openBlob(item: Blob, rehash: boolean) {
  const fd = await open(path.join(root, item.key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!fd) return null;
  try {
    const first = await fd.stat({ bigint: true });
    if (!first.isFile() || first.size !== BigInt(item.size)) throw new Error();
    const identity = fingerprint(first);
    if (rehash || identity !== item.fingerprint) {
      const digest = createHash("sha256");
      for await (const part of fd.createReadStream({ autoClose: false, start: 0, end: item.size - 1 })) digest.update(part);
      if (digest.digest("hex") !== item.sha256 || identity !== fingerprint(await fd.stat({ bigint: true }))) throw new Error();
    }
    return fd;
  } catch {
    await fd.close().catch(() => undefined);
    return null;
  }
}

export async function hasPaymentBlob(item: Blob) {
  const fd = await openBlob(item, false);
  if (!fd) return false;
  await fd.close();
  return true;
}

export async function streamPaymentBlob(item: Blob) {
  const fd = await openBlob(item, true);
  if (!fd) return null;
  return Readable.toWeb(fd.createReadStream({ start: 0, end: item.size - 1 })) as ReadableStream<Uint8Array>;
}

export async function readPaymentOcr(item: Blob) {
  const fd = await openBlob(item, true);
  if (!fd) return null;
  try {
    return await fd.readFile();
  } finally {
    await fd.close();
  }
}

/** Only used by the staged legacy conversion. Never accepts an arbitrary path. */
export async function readLegacyPaymentInput(key: string, size: number) {
  if (!/^\d{4}\/\d{2}\/[A-Za-z0-9_-]{24}\.[a-z0-9]+$/.test(key) || size < 1 || size > MAX_PAYMENT_FILE) return null;
  const fd = await open(path.join(root, key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
  if (!fd) return null;
  try {
    const first = await fd.stat({ bigint: true });
    if (!first.isFile() || first.size !== BigInt(size)) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of fd.createReadStream({ autoClose: false, start: 0, end: size - 1 })) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    return bytes.length === size && fingerprint(first) === fingerprint(await fd.stat({ bigint: true })) ? bytes : null;
  } finally {
    await fd.close().catch(() => undefined);
  }
}
