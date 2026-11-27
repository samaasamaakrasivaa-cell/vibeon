import "server-only";
import type { Invoice, Prisma, User } from "@prisma/client";
import { db } from "../db";
import { fileUrl } from "../storage";
import { paymentDocumentExtension } from "./document-content";
import { hasPaymentBlob, paymentArtifact } from "./payment-artifacts";

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

export async function usablePaymentUpload(upload: { paymentArtifact: Prisma.JsonValue | null }) {
  const artifact = paymentArtifact(upload.paymentArtifact);
  return artifact && await hasPaymentBlob(artifact.document) ? artifact : null;
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

export async function invoiceDocumentStates(invoices: InvoiceDocumentView[]) {
  const paths = invoices.flatMap(({ proofFile, receiptFile }) =>
    [proofFile, receiptFile].flatMap((url) => url?.startsWith("/api/files/") ? [url.slice("/api/files/".length)] : []));
  const uploads = paths.length
    ? await db.upload.findMany({
      where: { path: { in: [...new Set(paths)] }, paymentKind: { in: ["PROOF", "RECEIPT"] } },
      select: { id: true, path: true, ownerId: true, paymentKind: true, paymentInvoiceId: true, paymentArtifact: true },
    })
    : [];
  const states = new Map();
  for (const upload of uploads) {
    states.set(fileUrl(upload.path), { upload, pending: upload.paymentArtifact === null, available: !!await usablePaymentUpload(upload) });
  }
  const versions = uploads.length ? await db.invoiceDocumentVersion.findMany({
    where: { uploadId: { in: uploads.map((upload) => upload.id) }, restored: true },
    select: { uploadId: true, changedAt: true },
  }) : [];
  const restored = new Map(versions.map((v) => [v.uploadId, v.changedAt]));

  return (invoice: InvoiceDocumentView, kind: PaymentDocument): { href: string | null; pending: boolean; restoredAt?: Date } => {
    const ref = invoice[paymentDocumentField(kind)];
    const state = ref ? states.get(ref) : undefined;
    const upload = state?.upload;
    const ownerId = kind === "proof" ? invoice.student.userId : invoice.student.teacherId;
    if (!state || !upload || upload.paymentKind !== paymentKinds[kind] || upload.paymentInvoiceId !== invoice.id || upload.ownerId !== ownerId) {
      return { href: null, pending: false };
    }
    return { href: state.available ? `/api/billing/documents/${invoice.id}/${kind}/${upload.id}` : null,
      pending: state.pending, restoredAt: restored.get(upload.id) };
  };
}
