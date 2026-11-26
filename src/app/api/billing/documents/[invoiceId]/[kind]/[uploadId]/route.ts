import { getSessionUser } from "@/lib/auth/session";
import { paymentDocumentExtension } from "@/lib/billing/document-content";
import { currentPaymentDocument, parsePaymentDocument, readPaymentDocument } from "@/lib/billing/documents";

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
  if (!upload) return missing();
  const content = await readPaymentDocument(upload);
  if (!content) return missing();

  return new Response(req.method === "HEAD" ? null : new Uint8Array(content.buf), {
    headers: {
      ...headers,
      "Content-Type": content.mime,
      "Content-Length": String(content.buf.length),
      "Content-Disposition": `attachment; filename="${kind}.${paymentDocumentExtension(content.mime)}"`,
      "Accept-Ranges": "none",
    },
  });
}

export const HEAD = GET;
