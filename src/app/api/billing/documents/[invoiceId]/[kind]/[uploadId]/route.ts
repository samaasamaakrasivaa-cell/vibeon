import { getSessionUser } from "@/lib/auth/session";
import { paymentDocumentExtension } from "@/lib/billing/document-content";
import { currentPaymentDocument, parsePaymentDocument } from "@/lib/billing/documents";
import { hasPaymentBlob, paymentArtifact, streamPaymentBlob } from "@/lib/billing/payment-artifacts";

type Params = { params: Promise<{ invoiceId: string; kind: string; uploadId: string }> };
const headers = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export async function GET(req: Request, { params }: Params) {
  const missing = () => new Response(null, { status: 404, headers });
  const actor = await getSessionUser();
  const { invoiceId, kind: rawKind, uploadId } = await params;
  const kind = parsePaymentDocument(rawKind);
  if (!actor || !kind) return missing();
  const upload = await currentPaymentDocument(invoiceId, kind, uploadId, actor);
  const artifact = paymentArtifact(upload?.paymentArtifact);
  if (!artifact) return missing();

  const document = artifact.document;
  let body = null;
  if (req.method === "HEAD") {
    if (!await hasPaymentBlob(document)) return missing();
  } else {
    body = await streamPaymentBlob(document);
    if (!body) return missing();
  }
  return new Response(body, {
    headers: {
      ...headers,
      "Content-Type": document.mime,
      "Content-Length": String(document.size),
      "Content-Disposition": `attachment; filename="${kind}.${paymentDocumentExtension(document.mime)}"`,
      "Accept-Ranges": "none",
    },
  });
}

export const HEAD = GET;
