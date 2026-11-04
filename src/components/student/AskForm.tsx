"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { askAi, escalateQuestion } from "@/lib/ai/actions";
import { useT } from "@/lib/i18n/client";
import { Icon } from "../Icon";

/** Вопрос: сначала отвечает ИИ, затем можно спросить преподавателя. */
export function AskForm({ contexts }: { contexts: string[] }) {
  const { t } = useT();
  const router = useRouter();
  const [v, setV] = useState("");
  const [ctx, setCtx] = useState(contexts[0] ?? "");
  const [ai, setAi] = useState<{ id: string; answer: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = () => { setAi(null); setV(""); setTimeout(() => router.refresh(), 0); };
  return (
    <form className="card flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { setErr(null); const r = await askAi(v, ctx); if (r.ok) setAi({ id: r.id, answer: r.answer }); else setErr(r.error); }); }}>
      <h3>{t("sq.ask")}</h3>
      {ai ? (
        <>
          <p className="m-0 font-semibold">{v}</p>
          <div className="aianswer"><span className="tk-aiico"><Icon name="spark" size="sm" /></span><div><b className="small">{t("ai.says")}</b><p className="m-0 mt-1">{ai.answer}</p></div></div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn secondary" disabled={pending} onClick={() => start(async () => { await escalateQuestion(ai.id); done(); })}>{t("cls.askTeacher")}</button>
            <button type="button" className="btn primary" onClick={done}>{t("ai.clear")}</button>
          </div>
        </>
      ) : (
        <>
          {contexts.length > 0 && <select className="select" value={ctx} onChange={(e) => setCtx(e.target.value)} aria-label={t("sq.about")}>{contexts.map((c) => <option key={c}>{c}</option>)}<option value="">{t("sq.general")}</option></select>}
          <textarea className="textarea" value={v} onChange={(e) => setV(e.target.value)} placeholder={t("sq.ph")} aria-label={t("sq.ask")} />
          <span className="hint">{t("cls.aiFirst")}</span>
          {err && <div className="alert">{err}</div>}
          <div className="flex justify-end"><button className="btn primary" disabled={pending || !v.trim()}><Icon name="spark" size="sm" />{pending ? t("ai.thinking") : t("ai.ask")}</button></div>
        </>
      )}
    </form>
  );
}

export function EscalateButton({ id }: { id: string }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button className="btn secondary sm mt-2" disabled={pending} onClick={() => start(async () => { await escalateQuestion(id); setTimeout(() => router.refresh(), 0); })}>{t("cls.askTeacher")}</button>;
}
