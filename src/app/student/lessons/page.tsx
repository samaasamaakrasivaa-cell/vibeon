import { StudyHead } from "@/components/student/SectionTabs";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { homeworkFor } from "@/lib/homework";
import { isoDay } from "@/lib/time";

export const metadata = { title: "Учёба" };
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
  // назначенный тест — тоже домашняя работа
  // здесь — только тесты, которые ещё надо пройти или ждут проверки; результаты — в «Мой прогресс → Тесты»
  const tests = await db.placementAttempt.findMany({ where: { studentId: s.id, mode: "student", checkpointId: { not: null }, status: { in: ["new", "active", "submitted"] } }, orderBy: { createdAt: "desc" }, take: 20 });
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
      <StudyHead active="lessons" />
      {tests.length > 0 && (
        <section className="card mb-6">
          <p className="cardtitle">{t("stl.tests")}</p>
          {tests.map((x) => (
            <Link key={x.id} href={`/student/test/${x.checkpointId}`} className="row hover:bg-surface2">
              <span className="pill violet"><Icon name="target" size="sm" /></span>
              <div className="grow"><div className="t">{x.track === "teen" ? "Placement test Teens" : "Placement test"}</div><div className="s">{x.status === "reviewed" ? (x.reviewedAt ?? x.createdAt).toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: tz }) : x.status === "submitted" ? t("stl.testSent") : x.status === "active" ? t("stl.testGoOn") : t("stl.testStart")}</div></div>
              {x.status === "reviewed" ? <span className="pill green">{x.level ?? "✓"} · {t("stl.testOpen")}</span>
                : <span className={`pill ${x.status === "submitted" ? "orange" : "red"}`}>{x.status === "submitted" ? t("stl.hwSent") : t("stl.hwTodo")}</span>}
            </Link>
          ))}
        </section>
      )}
      {courses.length === 0 ? <div className="card"><p className="hint m-0">{t("stl.none")}</p></div> : (
        <>
          <nav className="tabsbar fit mb-6">
            {courses.map((c) => <Link key={c.id} href={`?c=${c.id}`} aria-current={c.id === cid ? "page" : undefined}><Icon name="book" size="sm" /> {c.title}</Link>)}
          </nav>
          {units.map((u) => (
            <section key={u.id} className="mb-6">
              <h2 className={`${u.outcomes.length ? "mb-2" : "mb-3"} text-[19px]`}>{u.title}</h2>
              {u.outcomes.length > 0 && <p className="unit-topics-s">{u.outcomes.join(" · ")}</p>}
              <div className="list">
                {inCourse.filter((l) => l.template!.unitId === u.id).map((l) => {
                  const [c, label] = status(l);
                  return (
                    <Link key={l.id} href={`/class/${l.id}${l.status === "DONE" ? "?tab=homework" : ""}`} className="row hover:bg-surface2">
                      <div className="min-w-[90px]"><b className="block">{l.startsAt.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: tz }).replace(".", "")}</b><span className="small muted">{l.startsAt.toLocaleDateString(loc, { weekday: "short", timeZone: tz })}</span></div>
                      {/* картинка урока (или курса) — если учитель загрузил */}
                      {(l.template!.cover || l.template!.unit.course.cover) && <span className="lcover has" style={{ backgroundImage: `url(${l.template!.cover || l.template!.unit.course.cover})`, cursor: "inherit" }} aria-hidden="true" />}
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
