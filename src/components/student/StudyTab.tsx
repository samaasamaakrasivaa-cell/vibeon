import Link from "next/link";
import { Icon } from "../Icon";
import { StudentWeek } from "./StudentWeek";
import { getT } from "@/lib/i18n/server";
import { weekView } from "@/lib/study/week-view";
import { addDaysIso, weekRange } from "@/lib/time";

/** Анкета ученика у учителя → «Самостоятельно»: неделя ученика (уроки и его слоты), выполнение, «Запланировать ученику». */
export async function StudyTab({ studentId, tz, w }: { studentId: string; tz: string; w?: string }) {
  const { t, lang } = await getT();
  const v = await weekView(studentId, tz, w, lang === "en" ? "en" : "ru", t as never, true);
  const q = (iso: string) => `?tab=study&w=${iso}`;
  return (
    <>
      <p className="muted mt-0">{t("st.teacherLead")}</p>
      <StudentWeek days={v.days} lessons={v.lessons} hourFrom={v.hourFrom} hourTo={v.hourTo} nowDay={v.nowDay} nowMin={v.nowMin} title={t("sts.week")} study={v.study} nav={
        <div className="weeknav">
          <Link href={q(addDaysIso(v.monday, -7))} aria-label={t("sch.prev")}><Icon name="chevl" size="sm" /></Link>
          <span>{weekRange(v.monday, tz, v.loc)}</span>
          <Link href={q(addDaysIso(v.monday, 7))} aria-label={t("sch.next")}><Icon name="right" size="sm" /></Link>
        </div>
      } />
    </>
  );
}
