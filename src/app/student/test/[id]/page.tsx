import { notFound } from "next/navigation";
import Link from "next/link";
import { TestRunner } from "@/components/roadmap/TestRunner";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import type { Stage } from "@/lib/roadmap/cefr";
import { itemsFor, publicItems, WRITING_PROMPT } from "@/lib/roadmap/testbank";

export const metadata = { title: "Тест" };

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const me = await requireUser("STUDENT");
  const { id } = await params;
  const c = await db.checkpoint.findUnique({ where: { id }, include: { student: true, roadmap: true } });
  if (!c || c.student.userId !== me.id) notFound();
  if (c.status === "done")
    return (
      <div className="page" style={{ maxWidth: 760 }}>
        <section className="card text-center"><h2 className="mt-0">{t("ts.doneTitle", { lvl: c.level ?? "—" })}</h2><p className="muted">{t("ts.doneSub")}</p><Link className="btn primary" href="/student/route?tab=a">{t("ts.toRoute")}</Link></section>
      </div>
    );
  const stages = (c.roadmap?.stages as Stage[] | undefined) ?? [];
  const items = publicItems(itemsFor(c.kind as "entry", c.kind === "entry" ? null : stages[c.stage ?? 0]?.lvl));
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1 className="mb-1">{c.kind === "entry" ? t("rm.entry") : c.kind === "final" ? t("rt.finalTest") : t("rt.sliceTest")}</h1>
      <p className="muted mt-0 mb-5">{t("ts.lead", { n: items.length + 1 })}</p>
      <TestRunner id={c.id} items={items} writing={WRITING_PROMPT} />
    </div>
  );
}
