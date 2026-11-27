import { getSessionUser } from "@/lib/auth/session";
import { inspectPaymentDocument } from "@/lib/billing/document-content";
import { invoiceForDocumentWrite, parsePaymentDocument, paymentKinds } from "@/lib/billing/documents";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { saveFile } from "@/lib/storage";
import { MAX_PAYMENT_FILE, readPaymentUploadBody } from "@/lib/billing/payment-upload-body";

type Params = { params: Promise<{ invoiceId: string; kind: string }> };
const headers = { "Cache-Control": "private, no-store" };
const error = (status: number, code: string) => Response.json({ error: code }, { status, headers });

export async function POST(req: Request, { params }: Params) {
  const actor = await getSessionUser();
  if (!actor) return error(401, "auth");
  const { invoiceId, kind: rawKind } = await params;
  const kind = parsePaymentDocument(rawKind);
  if (!kind) return error(404, "not found");
  const invoice = await invoiceForDocumentWrite(invoiceId, kind, actor);
  if (!invoice) return error(404, "not found");
  if (!await rateLimit("payment-document:" + actor.id, 12)) return error(429, "rate");
  const parsed = await readPaymentUploadBody(req);
  if ("status" in parsed) return error(parsed.status, parsed.status === 413 ? "size" : "file");
  const entries = parsed.form.getAll("file");
  const file = entries[0];
  if (entries.length !== 1 || !(file instanceof File) || !file.size) return error(400, "file");
  if (file.size > MAX_PAYMENT_FILE) return error(413, "size");
  const content = await inspectPaymentDocument(Buffer.from(await file.arrayBuffer()), file.type);
  if (!content) return error(415, "type");
  if (content.buf.length > MAX_PAYMENT_FILE) return error(413, "size");

  const path = await saveFile(content.buf, content.mime);
  const upload = await db.upload.create({
    data: {
      ownerId: actor.id, path, name: file.name.slice(0, 200), mime: content.mime, size: content.buf.length,
      paymentKind: paymentKinds[kind], paymentInvoiceId: invoiceId, paymentRevision: invoice.revision,
    },
    select: { id: true },
  });
  return Response.json({ id: upload.id }, { status: 201, headers });
}
