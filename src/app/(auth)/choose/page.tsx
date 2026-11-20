import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { ChooseCabinet } from "@/components/auth/ChooseCabinet";
import { getT } from "@/lib/i18n/server";
import { getSessionUser, homeFor } from "@/lib/auth/session";
import { linkedOf } from "@/lib/auth/cabinet";

export const metadata = { title: "Выбор кабинета" };
export const dynamic = "force-dynamic";

/** После входа: у человека кабинет ученика и кабинет учителя на одном входе — выбирает, куда зайти. */
export default async function ChoosePage() {
  const { t } = await getT();
  const me = await getSessionUser();
  if (!me) redirect("/login");
  const other = await linkedOf(me);
  if (!other) redirect(homeFor(me.role));
  const name = [me.name, me.lastName].filter(Boolean).join(" ");
  return (
    <AuthShell>
      <section className="authcard" style={{ maxWidth: 460 }}>
        <h1>{t("ch.title", { name: me.name })}</h1>
        <p className="sub">{t("ch.lead")}</p>
        <ChooseCabinet mine={{ role: me.role, href: homeFor(me.role) }} other={{ role: other.role }} who={name} />
      </section>
    </AuthShell>
  );
}
