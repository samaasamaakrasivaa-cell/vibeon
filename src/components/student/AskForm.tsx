"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { askQuestion } from "@/lib/student/actions";
import { useT } from "@/lib/i18n/client";

export function AskForm({ contexts }: { contexts: string[] }) {
  const { t } = useT();
  const router = useRouter();
  const [v, setV] = useState("");
  const [ctx, setCtx] = useState(contexts[0] ?? "");
  const [pending, start] = useTransition();
  return (
    <form className="card flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { await askQuestion(v, ctx); setV(""); }); }}>
      <h3>{t("sq.ask")}</h3>
      {contexts.length > 0 && <select className="select" value={ctx} onChange={(e) => setCtx(e.target.value)} aria-label={t("sq.about")}>{contexts.map((c) => <option key={c}>{c}</option>)}<option value="">{t("sq.general")}</option></select>}
      <textarea className="textarea" value={v} onChange={(e) => setV(e.target.value)} placeholder={t("sq.ph")} aria-label={t("sq.ask")} />
      <div className="flex justify-end"><button className="btn primary" disabled={pending || !v.trim()}>{t("cls.askTeacher")}</button></div>
    </form>
  );
}
