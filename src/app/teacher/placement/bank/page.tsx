import Link from "next/link";
import { notFound } from "next/navigation";
import { BankEditor } from "@/components/placement/BankEditor";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { getBank, isOwner, TEEN_IDS, trackOf } from "@/lib/placement/bank";

export const metadata = { title: "Placement test — банк заданий" };
export const dynamic = "force-dynamic";

/** Режим владельца платформы: правка банка вводного теста. Другим учителям страница недоступна. */
export default async function BankPage({ searchParams }: { searchParams: Promise<{ track?: string }> }) {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  if (!isOwner(me.email)) notFound();
  const track = trackOf((await searchParams).track);
  const { bank } = await getBank(track);
  const edits = await db.placementEdit.findMany({ select: { itemId: true, data: true, audio: true } });
  const fl = (await db.placementFlag.findMany({ orderBy: { createdAt: "desc" }, take: 300 })).filter((f) => TEEN_IDS.has(f.itemId) === (track === "teen"));
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(fl.map((f) => f.userId))] } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name || u.email.replace(/@.*/, "")]));
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  const flags = fl.map((f) => ({ id: f.id, itemId: f.itemId, qid: f.qid, note: f.note, who: users.get(f.userId) ?? "—", when: fmt.format(f.createdAt), resolved: !!f.resolvedAt }));
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <Link href="/teacher/courses?tab=tests" className="small muted">← {t("pl.backTests")}</Link>
      <h1 className="mt-2 mb-1">{t("pl.bankTitle")}</h1>
      <p className="muted mt-0 mb-3">{t("pl.bankLead")}</p>
      <nav className="seg mb-5" aria-label={t("pl.track")}>
        <Link href="/teacher/placement/bank" aria-current={track === "adult" ? "page" : undefined}>{t("pl.bankAdult")}</Link>
        <Link href="/teacher/placement/bank?track=teen" aria-current={track === "teen" ? "page" : undefined}>{t("pl.bankTeen")}</Link>
      </nav>
      <BankEditor
        items={[...bank.core, ...bank.reading, ...bank.listening, ...bank.writing, ...bank.speaking]}
        edited={edits.filter((e) => Object.keys((e.data ?? {}) as object).length).map((e) => e.itemId)}
        audioEdited={edits.filter((e) => e.audio).map((e) => e.itemId)}
        groups={bank.groups.map((g) => ({ id: g.id, name: g.name_ru }))}
        flags={flags}
      />
    </div>
  );
}
