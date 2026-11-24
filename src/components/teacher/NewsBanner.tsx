import Link from "next/link";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { Icon } from "../Icon";

/** Главная учителя: новости и нововведения платформы, которых учитель ещё не открывал (гаснет, когда открыл «О платформе»). */
export async function NewsBanner({ userId }: { userId: string }) {
  const { t } = await getT();
  const prof = await db.teacherProfile.findUnique({ where: { userId }, select: { settings: true } });
  const seen = (prof?.settings as { newsSeenAt?: string } | null)?.newsSeenAt;
  const fresh = await db.article.findMany({
    where: { published: true, kind: { in: ["news", "digest"] }, audience: { in: ["teacher", "all"] }, ...(seen ? { updatedAt: { gt: new Date(seen) } } : {}) },
    orderBy: { updatedAt: "desc" }, take: 3, select: { id: true, title: true },
  });
  if (!fresh.length) return null;
  return (
    <Link href="/teacher/platform?tab=news" className="newsbn mb-5">
      <span className="newsbn-ic"><Icon name="spark" size="sm" /></span>
      <span className="grow min-w-0">
        <b className="block">{t("nb.title", { n: fresh.length })}</b>
        <span className="small muted newsbn-list">{fresh.map((x) => x.title).join(" · ")}</span>
      </span>
      <Icon name="right" size="sm" />
    </Link>
  );
}
