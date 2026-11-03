import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { OnboardForm } from "@/components/auth/OnboardForm";
import { getT } from "@/lib/i18n/server";
import { getValidInvite } from "@/lib/invite";

export const metadata = { title: "Анкета ученика" };

export default async function OnboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { t } = await getT();
  const { token } = await params;
  const inv = await getValidInvite(token);
  if (!inv) redirect(`/invite/${token}`);
  return (
    <AuthShell>
      <section className="authcard wide">
        <h1>{t("ob.welcome")}</h1>
        <p className="sub">{t("ob.lead")}</p>
        <OnboardForm token={token} init={{ first: inv.student.name, email: inv.student.email ?? "" }} />
      </section>
    </AuthShell>
  );
}
