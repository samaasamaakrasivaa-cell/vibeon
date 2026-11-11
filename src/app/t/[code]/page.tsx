import Link from "next/link";
import { cookies } from "next/headers";
import { AuthShell } from "@/components/auth/AuthShell";
import { GuestStart } from "@/components/placement/GuestStart";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Placement test", robots: { index: false } };

/** Ссылка «для нового человека»: вводный тест без регистрации. */
export default async function GuestTest({ params }: { params: Promise<{ code: string }> }) {
  const { t } = await getT();
  const code = (await params).code.toLowerCase();
  const link = await db.placementLink.findUnique({ where: { code } });
  if (!link || !link.active) {
    return <AuthShell><section className="authcard text-center"><h1>{t("pl.linkOff")}</h1><p className="muted">{t("pl.linkOffText")}</p></section></AuthShell>;
  }
  const teacher = await db.user.findUnique({ where: { id: link.teacherId }, select: { name: true, lastName: true } });
  // этот браузер уже начал тест по ссылке — предлагаем продолжить
  const jar = await cookies();
  const ids = jar.getAll().filter((c) => c.name.startsWith("vo_pt_")).map((c) => c.name.slice(6));
  const mine = ids.length ? await db.placementAttempt.findFirst({ where: { id: { in: ids }, linkId: link.id }, orderBy: { createdAt: "desc" } }) : null;
  const valid = mine && jar.get(`vo_pt_${mine.id}`)?.value === mine.token ? mine : null;
  return (
    <AuthShell>
      <section className="authcard">
        <h1 className="mb-1">{t("pl.title")}</h1>
        <p className="muted mt-0">{t("pl.guestLead", { name: `${teacher?.name ?? ""} ${teacher?.lastName ?? ""}`.trim() })}</p>
        {valid && <Link className="btn primary mb-4 w-full" href={`/placement/${valid.id}`}>{valid.status === "submitted" || valid.status === "reviewed" ? t("pl.guestSeeDone") : t("pl.guestContinue")}</Link>}
        <GuestStart code={code} />
      </section>
    </AuthShell>
  );
}
