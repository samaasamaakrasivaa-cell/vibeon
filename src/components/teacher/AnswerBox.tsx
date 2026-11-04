"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerQuestion } from "@/lib/student/actions";
import { useT } from "@/lib/i18n/client";

export function AnswerBox({ id }: { id: string }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button className="btn primary sm" onClick={() => setOpen(true)}>{t("qs.answer")}</button>;
  return (
    <div className="mt-2 flex w-full flex-col gap-2">
      <textarea className="textarea" value={v} onChange={(e) => setV(e.target.value)} placeholder={t("qs.answerPh")} autoFocus aria-label={t("qs.answer")} />
      {err && <span className="small text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <button className="btn secondary sm" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
        <button className="btn primary sm" disabled={pending || !v.trim()} onClick={() => start(async () => { const r = await answerQuestion(id, v); if (!r.ok) setErr(r.error); })}>{t("cls.send")}</button>
      </div>
    </div>
  );
}
