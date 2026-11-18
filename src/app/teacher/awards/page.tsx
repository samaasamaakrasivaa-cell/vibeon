import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth/session";
import { isOwner } from "@/lib/placement/bank";
import { getCatalog } from "@/lib/awards/catalog-db";
import { CatalogEditor } from "@/components/awards/CatalogEditor";

export const metadata = { title: "Каталог статусов" };

/** Каталог статусов — правит только владелец платформы (OWNER_EMAIL); изменения видят все учителя. */
export default async function AwardsCatalog() {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  if (!isOwner(me.email)) notFound();
  const items = await getCatalog({ withHidden: true });
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <Link href="/teacher/students" className="alink small">← {t("nav.students")}</Link>
      <h1 className="mb-2 mt-2">{t("cat.title")}</h1>
      <p className="muted mt-0 mb-5">{t("cat.lead")}</p>
      <CatalogEditor items={items} />
    </div>
  );
}
