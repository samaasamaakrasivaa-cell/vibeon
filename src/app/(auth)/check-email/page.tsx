import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { Resend } from "@/components/auth/Resend";
import { Icon } from "@/components/Icon";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Проверьте почту" };

/** Ссылка «Открыть почту» для популярных почтовых сервисов. */
function webmail(email: string) {
  const d = email.split("@")[1]?.toLowerCase() ?? "";
  if (["mail.ru", "inbox.ru", "list.ru", "bk.ru", "internet.ru"].includes(d)) return "https://e.mail.ru/inbox/";
  if (["yandex.ru", "ya.ru", "yandex.com", "narod.ru"].includes(d)) return "https://mail.yandex.ru/";
  if (["gmail.com", "googlemail.com"].includes(d)) return "https://mail.google.com/";
  if (["rambler.ru"].includes(d)) return "https://mail.rambler.ru/";
  if (["outlook.com", "hotmail.com", "live.com"].includes(d)) return "https://outlook.live.com/mail/";
  if (["icloud.com", "me.com"].includes(d)) return "https://www.icloud.com/mail";
  return null;
}

export default async function CheckEmail({ searchParams }: { searchParams: Promise<{ e?: string; k?: string; f?: string }> }) {
  const { t } = await getT();
  const sp = await searchParams;
  const email = (sp.e ?? "").slice(0, 200);
  const kind = (["verify", "magic", "reset"].includes(sp.k ?? "") ? sp.k : "verify") as "verify" | "magic" | "reset";
  const open = webmail(email);
  const back = kind === "verify" ? "/signup" : kind === "reset" ? "/forgot" : "/login";
  return (
    <AuthShell brand={false}>
      <section className="authcard text-center">
        <div className="bigicon"><Icon name="msg" /></div>
        {sp.f === "1" && <div className="alert mb-4 text-left" role="alert">{t("auth.check.failed")}</div>}
        <h1>{t("auth.check.title")}</h1>
        <p className="mt-3 mb-5 text-[16px] leading-normal text-text2">
          {t("auth.check.sent")} <b className="text-text">{email}</b>.{" "}
          {t(kind === "verify" ? "auth.check.verify" : kind === "magic" ? "auth.check.magic" : "auth.check.reset")}
        </p>
        {open && <a href={open} target="_blank" rel="noreferrer" className="btn primary w-full mb-5" style={{ borderRadius: 14, minHeight: 48 }}>{t("auth.check.open")}</a>}
        {email && <Resend email={email} kind={kind} />}
        <p className="hint mt-4 mb-0">{t("auth.check.spam")}</p>
        <p className="mt-4 mb-0 text-[14px]"><Link href={back} className="alink">{t("auth.check.change")}</Link></p>
      </section>
    </AuthShell>
  );
}
