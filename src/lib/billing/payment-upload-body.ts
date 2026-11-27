import "server-only";

export const MAX_PAYMENT_FILE = 10 * 1024 * 1024;
export const MAX_PAYMENT_BODY = MAX_PAYMENT_FILE + 64 * 1024;

type ParsedUpload = { form: FormData } | { status: 400 | 413 };

export async function readPaymentUploadBody(req: Request): Promise<ParsedUpload> {
  const contentType = req.headers.get("content-type");
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_PAYMENT_BODY)) return { status: 413 };
  if (!req.body || !contentType || !/^multipart\/form-data\s*;/i.test(contentType)) return { status: 400 };

  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_PAYMENT_BODY) {
        await reader.cancel().catch(() => undefined);
        return { status: 413 };
      }
      chunks.push(Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength));
    }
    const bytes = Buffer.concat(chunks, size);
    // The multipart decoder sees only a body whose actual length was checked.
    const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } }).formData();
    return { form };
  } catch {
    return { status: 400 };
  } finally {
    reader.releaseLock();
  }
}
