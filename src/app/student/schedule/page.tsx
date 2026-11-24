import Link from "next/link";
import { Icon } from "@/components/Icon";
import { StudentWeek } from "@/components/student/StudentWeek";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { weekView } from "@/lib/study/week-view";
import { getT } from "@/lib/i18n/server";
import { addDaysIso, weekRange } from "@/lib/time";

export const metadata = { title: "Расписание" };
export const dynamic = "force-dynamic";

export default async function StudentSchedule({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  const tz = me.timezone;
  const w = (await searchParams).w;
  const v = await weekView(s?.id ?? null, tz, w, lang === "en" ? "en" : "ru", t as never);
  const { monday, loc } = v;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>{t("nav.schedule")}</h1>
      <p className="muted mt-2">{t("sts.lead")}</p>
      <StudentWeek days={v.days} lessons={v.lessons} hourFrom={v.hourFrom} hourTo={v.hourTo} nowDay={v.nowDay} nowMin={v.nowMin} title={t("sts.week")} study={v.study} nav={
        <div className="weeknav">
          <Link href={`?w=${addDaysIso(monday, -7)}`} aria-label={t("sch.prev")}><Icon name="chevl" size="sm" /></Link>
          <span>{weekRange(monday, tz, loc)}</span>
          <Link href={`?w=${addDaysIso(monday, 7)}`} aria-label={t("sch.next")}><Icon name="right" size="sm" /></Link>
        </div>
      } />
    </div>
  );
}
