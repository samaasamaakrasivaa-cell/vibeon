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

export function InviteForm() {
  const { t } = useT();
  const [st, action] = useActionState<FormState, FormData>(inviteStudentAction, undefined);
  const router = useRouter();
  // Обновляем список «Приглашены» после того, как отправка завершилась.
  useEffect(() => {
    if (st?.link) router.refresh();
  }, [st?.link, router]);
  return (
    <div>
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
        <div className="field"><label htmlFor="iname">{t("inviteT.name")}</label><input id="iname" name="name" className="input" placeholder={t("auth.namePh") === "Elvira" ? "Anna" : "Анна"} defaultValue={st?.fields?.name} required /></div>
        <div className="field"><label htmlFor="icontact">{t("inviteT.contact")}</label><input id="icontact" name="contact" className="input" placeholder={t("inviteT.contactPh")} defaultValue={st?.fields?.contact} required /></div>
        <Submit className="btn primary">{t("inviteT.send")}</Submit>
      </form>
      <p className="hint mt-2 mb-0">{t("inviteT.hint")}</p>
      {st?.error && <div className="alert mt-3" role="alert">{st.error}</div>}
      {st?.link && (
        <div className={`alert ${st.warn ? "" : "ok"} mt-3 flex flex-wrap items-center gap-3`} role={st.warn ? "alert" : undefined}>
          <span className="w-full">{st.ok?.includes("@") ? st.ok : `${st.ok} — ${t("inviteT.copy").toLowerCase()}:`}</span>
          <code className="invlink">{st.link}</code>
          <CopyLink link={st.link} />
          {st.id && <a className="btn primary sm" href={`/teacher/schedule?new=1&trial=1&student=${st.id}`}><Icon name="cal" size="sm" />{t("inviteT.trial")}</a>}
        </div>
      )}
    </div>
  );
}
