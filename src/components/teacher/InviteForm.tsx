"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteStudentAction, type FormState } from "@/lib/auth/actions";
import { saveMsgTemplate } from "@/lib/teacher/actions";
import { useT } from "@/lib/i18n/client";
import { Submit } from "../auth/Submit";
import { Icon } from "../Icon";

export function CopyLink({ link }: { link: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn tinted sm"
      onClick={async () => {
        try { await navigator.clipboard.writeText(link); } catch { window.prompt(t("inviteT.copy"), link); }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Icon name={copied ? "check" : "link"} size="sm" />
      {copied ? t("inviteT.copied") : t("inviteT.copy")}
    </button>
  );
}

/** Ссылка + способы отправить: Telegram, WhatsApp, «Поделиться» (телефон), копировать ссылку или готовый текст. */
export type MsgKind = "invite" | "access" | "payer";

/**
 * Ссылка + текст сообщения, который можно поправить перед отправкой (и сохранить как свой шаблон),
 * и способы отправить: Telegram, Max, «Поделиться» (телефон), скопировать ссылку или весь текст.
 */
export function ShareLink({ link, msg, kind, vars }: { link: string; msg: string; kind?: MsgKind; vars?: { name?: string; teacher?: string } }) {
  const { t } = useT();
  const [text, setText] = useState(msg);
  const [copied, setCopied] = useState<"" | "msg" | "max">("");
  const [canShare, setCanShare] = useState(false);
  const [saved, setSaved] = useState<"" | "ok" | "reset">("");
  const [pending, start] = useTransition();
  useEffect(() => setCanShare(typeof navigator !== "undefined" && !!navigator.share), []);
  useEffect(() => setText(msg), [msg]);
  const copy = async (what: "msg" | "max") => {
    try { await navigator.clipboard.writeText(text); } catch { window.prompt(t("inviteT.copy"), text); }
    setCopied(what); setTimeout(() => setCopied(""), 2500);
  };
  // в Telegram ссылка уходит отдельным полем — из текста её убираем, чтобы не было дважды
  const tgText = text.includes(link) ? text.replace(link, "").replace(/[ \t]+\n/g, "\n").replace(/\s*[—:-]\s*$/, "").trim() : text;
  // свой шаблон: имя, ссылка и подпись учителя заменяются метками
  const toTemplate = () => {
    let s = text.split(link).join("{ссылка}");
    if (vars?.name) s = s.split(vars.name).join("{имя}");
    if (vars?.teacher) s = s.split(vars.teacher).join("{учитель}");
    return s;
  };
  return (
    <div className="sharebox">
      <div className="flex flex-wrap items-center gap-2">
        <code className="invlink">{link.replace(/^https?:\/\//, "")}</code>
        <CopyLink link={link} />
      </div>
      <div className="field mt-3 mb-0">
        <label htmlFor={`msg-${kind ?? "x"}`} className="flex items-center justify-between gap-2"><span>{t("inviteT.msgLabel")}</span>{text !== msg && <button type="button" className="alink small" onClick={() => setText(msg)}>{t("inviteT.msgUndo")}</button>}</label>
        <textarea id={`msg-${kind ?? "x"}`} className="textarea msgedit" value={text} onChange={(e) => setText(e.target.value)} rows={4} />
        {kind && (
          <span className="hint flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" className="alink small" disabled={pending} onClick={() => start(async () => { const r = await saveMsgTemplate(kind, toTemplate()); setSaved(r.ok ? "ok" : ""); })}>{t("inviteT.tplSave")}</button>
            <button type="button" className="alink small text-text3" disabled={pending} onClick={() => start(async () => { const r = await saveMsgTemplate(kind, ""); if (r.ok) setSaved("reset"); })}>{t("inviteT.tplReset")}</button>
            {saved === "ok" && <span className="text-ok">✓ {t("inviteT.tplSaved")}</span>}
            {saved === "reset" && <span className="text-ok">✓ {t("inviteT.tplWasReset")}</span>}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className="btn sm shtg" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(tgText)}`}><Icon name="send" size="sm" />Telegram</a>
        <a className="btn sm shmax" target="_blank" rel="noreferrer" href="https://web.max.ru/" onClick={() => { void copy("max"); }}><Icon name="msg" size="sm" />Max</a>
        {canShare && <button type="button" className="btn secondary sm" onClick={() => navigator.share({ text }).catch(() => {})}><Icon name="link" size="sm" />{t("inviteT.share")}</button>}
        <button type="button" className="btn secondary sm" onClick={() => copy("msg")}>
          <Icon name={copied === "msg" ? "check" : "copy"} size="sm" />{copied === "msg" ? t("inviteT.copied") : t("inviteT.copyMsg")}
        </button>
      </div>
      {copied === "max" && <p className="small text-ok mt-2 mb-0">✓ {t("inviteT.maxHint")}</p>}
    </div>
  );
}

/** Кнопка, которая по нажатию создаёт ссылку на сервере (новое приглашение / восстановление доступа) и показывает, как её отправить. */
export function LinkMaker({ label, hint, make, icon = "link", kind, vars }: { label: string; hint?: string; make: () => Promise<{ ok: boolean; link?: string; msg?: string }>; icon?: string; kind?: MsgKind; vars?: { name?: string; teacher?: string } }) {
  const [res, setRes] = useState<{ link: string; msg: string } | null>(null);
  const [pending, setPending] = useState(false);
  // без router.refresh(): иначе строка перерисуется и блок «как отправить» пропадёт
  if (res) return <div className="grow">{hint && <p className="small muted mt-0 mb-2">{hint}</p>}<ShareLink link={res.link} msg={res.msg} kind={kind} vars={vars} /></div>;
  return (
    <button type="button" className="btn secondary sm" disabled={pending} onClick={async () => { setPending(true); const r = await make(); setPending(false); if (r.ok && r.link) setRes({ link: r.link, msg: r.msg ?? r.link }); }}>
      <Icon name={icon as "link"} size="sm" />{label}
    </button>
  );
}

export function InviteForm() {
  const { t } = useT();
  const [st, action] = useActionState<FormState, FormData>(inviteStudentAction, undefined);
  const router = useRouter();
  // Обновляем список «Приглашены», когда ссылка создана.
  useEffect(() => {
    if (st?.link) router.refresh();
  }, [st?.link, router]);
  return (
    <div>
      {!st?.link && (
        <>
          <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" noValidate>
            <div className="field"><label htmlFor="iname">{t("inviteT.name")}</label><input id="iname" name="name" className="input" placeholder={t("auth.namePh") === "Elvira" ? "Anna" : "Анна"} defaultValue={st?.fields?.name} required autoFocus /></div>
            <Submit className="btn primary">{t("inviteT.send")}</Submit>
          </form>
          <p className="hint mt-2 mb-0">{t("inviteT.hint")}</p>
        </>
      )}
      {st?.error && <div className="alert mt-3" role="alert">{st.error}</div>}
      {st?.link && (
        <div className="alert ok mt-1">
          <p className="mt-0 mb-3 font-semibold">{t("inviteT.ready", { name: st.ok ?? "" })}</p>
          <ShareLink link={st.link} msg={st.msg ?? st.link} kind="invite" vars={{ name: st.ok, teacher: st.fields?.teacher }} />
          <p className="small mt-3 mb-0 opacity-80">{t("inviteT.tgWhy")}</p>
          {st.id && <a className="btn primary sm mt-3" href={`/teacher/schedule?new=1&trial=1&student=${st.id}`}><Icon name="cal" size="sm" />{t("inviteT.trial")}</a>}
        </div>
      )}
    </div>
  );
}
