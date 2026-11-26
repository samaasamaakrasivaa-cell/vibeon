import "server-only";
import type { Invoice, Prisma, User } from "@prisma/client";
import { db } from "../db";
import { fileUrl, readStored } from "../storage";
import { inspectPaymentDocument, paymentDocumentExtension } from "./document-content";

export const paymentKinds = { proof: "PROOF", receipt: "RECEIPT" } as const;
export type PaymentDocument = keyof typeof paymentKinds;

export function parsePaymentDocument(kind: string): PaymentDocument | null {
  return kind === "proof" || kind === "receipt" ? kind : null;
}

export function paymentDocumentField(kind: PaymentDocument) {
  return kind === "proof" ? "proofFile" : "receiptFile";
}

export function invoiceDocumentAccess(actor: Pick<User, "id" | "role">): Prisma.InvoiceWhereInput {
  return actor.role === "STUDENT"
    ? { student: { userId: actor.id } }
    : { student: { teacherId: actor.id, teacher: { blockedAt: null } } };
}

export async function invoiceForDocumentWrite(id: string, kind: PaymentDocument, actor: Pick<User, "id" | "role">) {
  if (actor.role !== (kind === "proof" ? "STUDENT" : "TEACHER")) return null;
  return db.invoice.findFirst({ where: { id, ...invoiceDocumentAccess(actor) }, include: { student: true } });
}

export async function paymentUploadForWrite(uploadId: string, invoiceId: string, kind: PaymentDocument, ownerId: string) {
  const upload = await db.upload.findFirst({
    where: { id: uploadId, ownerId, paymentInvoiceId: invoiceId, paymentKind: paymentKinds[kind] },
  });
  return upload && paymentDocumentExtension(upload.mime) ? upload : null;
}

export async function readPaymentDocument(upload: { path: string; mime: string; size: number }) {
  const stored = await readStored(upload.path);
  if (!stored || stored.size !== upload.size) return null;
  return inspectPaymentDocument(stored.buf, upload.mime);
}

export async function currentPaymentDocument(invoiceId: string, kind: PaymentDocument, uploadId: string, actor: Pick<User, "id" | "role">) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, ...invoiceDocumentAccess(actor) },
    include: { student: { select: { userId: true, teacherId: true } } },
  });
  if (!invoice) return null;

  const ownerId = kind === "proof" ? invoice.student.userId : invoice.student.teacherId;
  if (!ownerId) return null;
  const upload = await paymentUploadForWrite(uploadId, invoiceId, kind, ownerId);
  return upload && invoice[paymentDocumentField(kind)] === fileUrl(upload.path) ? upload : null;
}

type InvoiceDocumentView = Pick<Invoice, "id" | "proofFile" | "receiptFile"> & {
  student: { userId: string | null; teacherId: string };
};

export async function invoiceDocumentLinks(invoices: InvoiceDocumentView[]) {
  const paths = invoices.flatMap(({ proofFile, receiptFile }) =>
    [proofFile, receiptFile].flatMap((url) => url?.startsWith("/api/files/") ? [url.slice("/api/files/".length)] : []));
  const uploads = paths.length
    ? await db.upload.findMany({
      where: { path: { in: [...new Set(paths)] }, paymentKind: { in: ["PROOF", "RECEIPT"] } },
      select: { id: true, path: true, ownerId: true, paymentKind: true, paymentInvoiceId: true, mime: true },
    })
    : [];
  const byUrl = new Map(uploads.map((upload) => [fileUrl(upload.path), upload]));

  return (invoice: InvoiceDocumentView, kind: PaymentDocument) => {
    const ref = invoice[paymentDocumentField(kind)];
    const upload = ref && byUrl.get(ref);
    const ownerId = kind === "proof" ? invoice.student.userId : invoice.student.teacherId;
    if (!upload || upload.paymentKind !== paymentKinds[kind] || upload.paymentInvoiceId !== invoice.id ||
        upload.ownerId !== ownerId || !paymentDocumentExtension(upload.mime)) return null;
    return `/api/billing/documents/${invoice.id}/${kind}/${upload.id}`;
  };
}
