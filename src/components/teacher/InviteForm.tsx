"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { inviteStudentAction, type FormState } from "@/lib/auth/actions";
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
export function ShareLink({ link, msg }: { link: string; msg: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && !!navigator.share), []);
  const rest = msg.replace(link, "").replace(/\s*—\s*$/, "").trim();
  return (
    <div className="sharebox">
      <div className="flex flex-wrap items-center gap-2">
        <code className="invlink">{link.replace(/^https?:\/\//, "")}</code>
        <CopyLink link={link} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <a className="btn sm shtg" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(rest)}`}><Icon name="send" size="sm" />Telegram</a>
        <a className="btn sm shwa" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(msg)}`}><Icon name="msg" size="sm" />WhatsApp</a>
        {canShare && <button type="button" className="btn secondary sm" onClick={() => navigator.share({ text: msg }).catch(() => {})}><Icon name="link" size="sm" />{t("inviteT.share")}</button>}
        <button type="button" className="btn secondary sm" onClick={async () => { try { await navigator.clipboard.writeText(msg); } catch { window.prompt(t("inviteT.copy"), msg); } setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          <Icon name={copied ? "check" : "copy"} size="sm" />{copied ? t("inviteT.copied") : t("inviteT.copyMsg")}
        </button>
      </div>
    </div>
  );
}

/** Кнопка, которая по нажатию создаёт ссылку на сервере (новое приглашение / восстановление доступа) и показывает, как её отправить. */
export function LinkMaker({ label, hint, make, icon = "link" }: { label: string; hint?: string; make: () => Promise<{ ok: boolean; link?: string; msg?: string }>; icon?: string }) {
  const [res, setRes] = useState<{ link: string; msg: string } | null>(null);
  const [pending, setPending] = useState(false);
  // без router.refresh(): иначе строка перерисуется и блок «как отправить» пропадёт
  if (res) return <div className="grow">{hint && <p className="small muted mt-0 mb-2">{hint}</p>}<ShareLink link={res.link} msg={res.msg} /></div>;
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
          <ShareLink link={st.link} msg={st.msg ?? st.link} />
          <p className="small mt-3 mb-0 opacity-80">{t("inviteT.tgWhy")}</p>
          {st.id && <a className="btn primary sm mt-3" href={`/teacher/schedule?new=1&trial=1&student=${st.id}`}><Icon name="cal" size="sm" />{t("inviteT.trial")}</a>}
        </div>
      )}
    </div>
  );
}
