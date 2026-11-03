import { notFound } from "next/navigation";
import { PrintTask } from "@/components/tasks/PrintTask";
import { PrintButton } from "@/components/tasks/PrintButton";
import { requireUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { loadLesson, ordered } from "@/lib/teacher/builder-data";

export const metadata = { title: "PDF" };

/** Печатная версия урока: «Сохранить как PDF» в окне печати браузера. С ?keys=1 — с ключами ответов. */
export default async function Print({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ keys?: string }> }) {
  const { t } = await getT();
  const me = await requireUser("TEACHER");
  const data = await loadLesson((await params).id);
  if (!data || data.l.unit.course.teacherId !== me.id) notFound();
  const keys = (await searchParams).keys === "1";
  const g = ordered(data.rubrics, data.tasks);
  let n = 0;
  return (
    <main className="print">
      <PrintButton label={t("bld.printNow")} />
      <div className="small">{data.l.unit.course.title} · Unit {data.unitNo} · Lesson {data.lessonNo}</div>
      <h1>{data.l.title}</h1>
      {data.l.subtitle && <p>{data.l.subtitle}</p>}
      {g.lesson.map((sec) => <div key={sec.title}><h2>{sec.title}</h2>{sec.tasks.map((task) => <PrintTask key={task.id} task={task} n={task.type === "divider" ? n : ++n} keys={keys} />)}</div>)}
      {g.homework.length > 0 && <><h2>{t("nav.homework")}</h2>{g.homework.map((task) => <PrintTask key={task.id} task={task} n={++n} keys={keys} />)}</>}
      {g.words.length > 0 && <><h2>{t("bld.newWords")}</h2>{g.words.map((task) => <PrintTask key={task.id} task={task} n={++n} keys={keys} />)}</>}
    </main>
  );
}
