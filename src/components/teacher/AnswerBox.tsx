"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerQuestion } from "@/lib/student/actions";
import { draftAnswer } from "@/lib/ai/actions";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";

export function AnswerBox({ id }: { id: string }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [drafting, setDrafting] = useState(false);
  const draft = async () => {
    setOpen(true); setDrafting(true); setErr(null);
    const r = await draftAnswer(id).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setDrafting(false);
    if (r.ok) setV(r.answer); else setErr(r.error);
  };
  if (!open) return (
    <div className="flex flex-wrap gap-2">
      <button className="btn primary sm" onClick={() => setOpen(true)}>{t("qs.answer")}</button>
      <button className="btn tinted sm" onClick={draft}><Icon name="spark" size="sm" />{t("qs.aiDraft")}</button>
    </div>
  );
  return (
    <div className="mt-2 flex w-full flex-col gap-2">
      <textarea className="textarea" value={v} onChange={(e) => setV(e.target.value)} placeholder={t("qs.answerPh")} autoFocus aria-label={t("qs.answer")} />
      {err && <span className="small text-bad">{err}</span>}
      <div className="flex justify-end gap-2">
        <button className="btn tinted sm" disabled={drafting} onClick={draft}><Icon name="spark" size="sm" />{drafting ? t("ai.thinking") : t("qs.aiDraft")}</button>
        <span className="grow" />
        <button className="btn secondary sm" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
        <button className="btn primary sm" disabled={pending || !v.trim()} onClick={() => start(async () => { const r = await answerQuestion(id, v); if (!r.ok) setErr(r.error); })}>{t("cls.send")}</button>
      </div>
    </div>
  );
}
