import Link from "next/link";
import { Icon } from "@/components/Icon";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { homeworkFor } from "@/lib/homework";
import { isoDay } from "@/lib/time";

export const metadata = { title: "Мои уроки" };
export const dynamic = "force-dynamic";

export default async function MyLessons({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  if (!s) return null;
  const tz = me.timezone;
  const lessons = await db.lessonInstance.findMany({
    where: { studentId: s.id, templateId: { not: null }, status: { not: "CANCELLED" } },
    include: { template: { include: { unit: { include: { course: true } } } } },
    orderBy: { startsAt: "desc" },
  });
  const hw = new Map((await homeworkFor({ studentId: s.id })).map((h) => [h.lesson.id, h]));
  const courses = [...new Map(lessons.map((l) => [l.template!.unit.course.id, l.template!.unit.course])).values()];
  const cid = (await searchParams).c ?? s.courseId ?? courses[0]?.id;
  const inCourse = lessons.filter((l) => l.template!.unit.courseId === cid);
  // юниты по убыванию порядка — свежие сверху, как в прототипе
  const units = [...new Map(inCourse.map((l) => [l.template!.unit.id, l.template!.unit])).values()].sort((a, b) => b.order - a.order);
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const today = isoDay(new Date(), tz);
  const now = new Date();
  const status = (l: (typeof lessons)[number]) => {
    if (isoDay(l.startsAt, tz) === today && l.status === "PLANNED") return ["blue", t("dash.today")];
    if (l.status === "PLANNED" && l.startsAt > now) return ["grey", t("sts.upcoming")];
    const h = hw.get(l.id);
    if (!h) return ["green", t("sch.st.done")];
    if (h.state === "checked") return ["green", t("stl.hwChecked")];
    if (h.state === "review" && h.done >= h.total) return ["orange", t("stl.hwSent")];
    return ["red", t("stl.hwTodo")];
  };
  return (
    <div className="page">
      <h1 className="mb-5">{t("nav.lessons")}</h1>
      {courses.length === 0 ? <div className="card"><p className="hint m-0">{t("stl.none")}</p></div> : (
        <>
          <nav className="tabsbar fit mb-6">
            {courses.map((c) => <Link key={c.id} href={`?c=${c.id}`} aria-current={c.id === cid ? "page" : undefined}><Icon name="book" size="sm" /> {c.title}</Link>)}
          </nav>
          {units.map((u) => (
            <section key={u.id} className="mb-6">
              <h2 className="mb-3 text-[19px]">{u.title}</h2>
              <div className="list">
                {inCourse.filter((l) => l.template!.unitId === u.id).map((l) => {
                  const [c, label] = status(l);
                  return (
                    <Link key={l.id} href={`/class/${l.id}${l.status === "DONE" ? "?tab=homework" : ""}`} className="row hover:bg-surface2">
                      <div className="min-w-[90px]"><b className="block">{l.startsAt.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: tz }).replace(".", "")}</b><span className="small muted">{l.startsAt.toLocaleDateString(loc, { weekday: "short", timeZone: tz })}</span></div>
                      <div className="grow"><div className="t">{l.template!.title}</div>{l.template!.subtitle && <div className="s">{l.template!.subtitle}</div>}</div>
                      <span className={`pill ${c}`}>{label}</span>
                      <Icon name="right" size="sm" className="text-text3" />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
