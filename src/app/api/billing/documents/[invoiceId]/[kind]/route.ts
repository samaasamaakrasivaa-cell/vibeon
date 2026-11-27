import { getSessionUser } from "@/lib/auth/session";
import { inspectPaymentDocument } from "@/lib/billing/document-content";
import { invoiceForDocumentWrite, parsePaymentDocument, paymentKinds } from "@/lib/billing/documents";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { persistPaymentArtifact, removePaymentArtifact } from "@/lib/billing/payment-artifacts";
import { MAX_PAYMENT_FILE, readPaymentUploadBody } from "@/lib/billing/payment-upload-body";

type Params = { params: Promise<{ invoiceId: string; kind: string }> };
const headers = { "Cache-Control": "private, no-store" };
const error = (status: number, code: string) => Response.json({ error: code }, { status, headers });

// Limit buffered multipart data in this Next.js process. The validator
// separately shares its one parsing slot across all processes on the instance.
let buffering = false;

export async function POST(req: Request, { params }: Params) {
  const actor = await getSessionUser();
  if (!actor) return error(401, "auth");
  const { invoiceId, kind: rawKind } = await params;
  const kind = parsePaymentDocument(rawKind);
  if (!kind) return error(404, "not found");
  const invoice = await invoiceForDocumentWrite(invoiceId, kind, actor);
  if (!invoice) return error(404, "not found");
  if (!await rateLimit("payment-document:" + actor.id, 12)) return error(429, "rate");
  if (buffering) return error(503, "busy");
  buffering = true;
  try {
    return await storePaymentDocument(req, actor.id, invoiceId, kind, invoice.revision);
  } finally {
    buffering = false;
  }
}

async function storePaymentDocument(req: Request, ownerId: string, invoiceId: string, kind: keyof typeof paymentKinds, revision: number) {
  const parsed = await readPaymentUploadBody(req);
  if ("status" in parsed) return error(parsed.status, parsed.status === 413 ? "size" : "file");
  const entries = parsed.form.getAll("file");
  const file = entries[0];
  if (entries.length !== 1 || !(file instanceof File) || !file.size) return error(400, "file");
  if (file.size > MAX_PAYMENT_FILE) return error(413, "size");
  const content = await inspectPaymentDocument(Buffer.from(await file.arrayBuffer()), file.type);
  if ("error" in content) {
    return error(content.error === "busy" ? 503 : content.error === "size" ? 413 : 415, content.error);
  }

  const artifact = await persistPaymentArtifact(content).catch(() => null);
  if (!artifact) return error(503, "busy");
  try {
    const upload = await db.upload.create({
      data: {
        ownerId, path: artifact.document.key, name: file.name.slice(0, 200), mime: content.mime,
        size: content.buf.length, paymentKind: paymentKinds[kind], paymentInvoiceId: invoiceId,
        paymentRevision: revision, paymentArtifact: artifact,
      },
      select: { id: true },
    });
    return Response.json({ id: upload.id }, { status: 201, headers });
  } catch {
    await removePaymentArtifact(artifact);
    return error(503, "busy");
  }
}
