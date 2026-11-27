"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { attachReceipt, replacePaymentProof } from "@/lib/billing/actions";
import { useT } from "@/lib/i18n/client";
import type { PaymentDocument } from "@/lib/billing/documents";
import { Icon } from "../Icon";

const errorKeys = {
  busy: "pay.documentBusy", size: "pay.documentSize", pixels: "pay.documentPixels",
  pages: "pay.documentPages", expanded: "pay.documentExpanded",
} as const;

export function paymentUploadMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return Object.hasOwn(errorKeys, code) ? errorKeys[code as keyof typeof errorKeys] : "pay.documentError";
}

export const paymentFileAccept = "image/png,image/jpeg,image/webp,application/pdf";

export async function uploadPaymentDocument(invoiceId: string, kind: PaymentDocument, file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`/api/billing/documents/${encodeURIComponent(invoiceId)}/${kind}`, { method: "POST", body: form });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const fallback = response.status === 413 ? "size" : response.status === 503 ? "busy" : "technical";
    throw new Error(typeof error?.error === "string" ? error.error : fallback);
  }
  return (await response.json()).id;
}

export function PaymentDocumentUpload({ id, kind, has }: { id: string; kind: PaymentDocument; has?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const label = kind === "proof" ? t("pay.proofReplace") : has ? t("pay.receiptReplace") : t("pay.attachReceipt");

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPending(true);
    setFailure(null);
    try {
      const uploadId = await uploadPaymentDocument(id, kind, file);
      const result = await (kind === "receipt" ? attachReceipt(id, uploadId) : replacePaymentProof(id, uploadId));
      if (!result.ok) setFailure(result.error);
      else router.refresh();
    } catch (error) {
      setFailure(t(paymentUploadMessage(error)));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label className="btn plain sm" style={{ cursor: "pointer" }}>
        <Icon name="clip" size="sm" />{pending ? t("common.saving") : label}
        <input type="file" accept={paymentFileAccept} className="sr-only" disabled={pending} onChange={upload} />
      </label>
      {failure && <span role="alert" className="small text-bad">{failure}</span>}
    </span>
  );
}
