import { getSessionUser } from "@/lib/auth/session";
import { inspectPaymentDocument } from "@/lib/billing/document-content";
import { invoiceForDocumentWrite, parsePaymentDocument, paymentKinds } from "@/lib/billing/documents";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_UPLOAD, saveFile } from "@/lib/storage";

type Params = { params: Promise<{ invoiceId: string; kind: string }> };
const headers = { "Cache-Control": "private, no-store" };
const error = (status: number, code: string) => Response.json({ error: code }, { status, headers });

export async function POST(req: Request, { params }: Params) {
  const actor = await getSessionUser();
  if (!actor) return error(401, "auth");
  const { invoiceId, kind: rawKind } = await params;
  const kind = parsePaymentDocument(rawKind);
  if (!kind || !await invoiceForDocumentWrite(invoiceId, kind, actor)) return error(404, "not found");
  if (!await rateLimit("payment-document:" + actor.id, 12)) return error(429, "rate");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size || file.size > MAX_UPLOAD) return error(400, "file");
  const content = await inspectPaymentDocument(Buffer.from(await file.arrayBuffer()), file.type);
  if (!content) return error(415, "type");

  const path = await saveFile(content.buf, content.mime);
  const upload = await db.upload.create({
    data: {
      ownerId: actor.id, path, name: file.name.slice(0, 200), mime: content.mime, size: content.buf.length,
      paymentKind: paymentKinds[kind], paymentInvoiceId: invoiceId,
    },
    select: { id: true },
  });
  return Response.json({ id: upload.id }, { status: 201, headers });
}
