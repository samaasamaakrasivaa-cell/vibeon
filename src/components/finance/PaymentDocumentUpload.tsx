"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { attachReceipt, replacePaymentProof } from "@/lib/billing/actions";
import { useT } from "@/lib/i18n/client";
import type { PaymentDocument } from "@/lib/billing/documents";
import { Icon } from "../Icon";

export const paymentFileAccept = "image/png,image/jpeg,image/webp,application/pdf";

export async function uploadPaymentDocument(invoiceId: string, kind: PaymentDocument, file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`/api/billing/documents/${encodeURIComponent(invoiceId)}/${kind}`, { method: "POST", body: form });
  if (!response.ok) throw new Error("Upload rejected");
  return (await response.json()).id;
}

export function PaymentDocumentUpload({ id, kind, has }: { id: string; kind: PaymentDocument; has?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = kind === "proof" ? t("pay.proofReplace") : has ? t("pay.receiptReplace") : t("pay.attachReceipt");

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPending(true);
    setFailed(false);
    try {
      const uploadId = await uploadPaymentDocument(id, kind, file);
      const result = await (kind === "receipt" ? attachReceipt(id, uploadId) : replacePaymentProof(id, uploadId));
      if (!result.ok) setFailed(true);
      else router.refresh();
    } catch {
      setFailed(true);
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
      {failed && <span role="alert" className="small text-bad">{t("pay.documentError")}</span>}
    </span>
  );
}
