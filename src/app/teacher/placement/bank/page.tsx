import Link from "next/link";
import { notFound } from "next/navigation";
import { BankEditor } from "@/components/placement/BankEditor";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { getBank, isOwner } from "@/lib/placement/bank";

export const metadata = { title: "Placement test — банк заданий" };
export const dynamic = "force-dynamic";

/** Режим владельца платформы: правка банка вводного теста. Другим учителям страница недоступна. */
export default async function BankPage() {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  if (!isOwner(me.email)) notFound();
  const { bank } = await getBank();
  const edits = await db.placementEdit.findMany({ select: { itemId: true, data: true, audio: true } });
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <Link href="/teacher/courses?tab=tests" className="small muted">← {t("pl.backTests")}</Link>
      <h1 className="mt-2 mb-1">{t("pl.bankTitle")}</h1>
      <p className="muted mt-0 mb-5">{t("pl.bankLead")}</p>
      <BankEditor
        items={[...bank.core, ...bank.reading, ...bank.listening, ...bank.writing, ...bank.speaking]}
        edited={edits.filter((e) => Object.keys((e.data ?? {}) as object).length).map((e) => e.itemId)}
        audioEdited={edits.filter((e) => e.audio).map((e) => e.itemId)}
        groups={bank.groups.map((g) => ({ id: g.id, name: g.name_ru }))}
      />
    </div>
  );
}
