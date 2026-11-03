import { notFound } from "next/navigation";
import { ShareView } from "@/components/tasks/ShareView";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { loadLesson, ordered } from "@/lib/teacher/builder-data";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Урок", robots: { index: false } };

/** Гостевая ссылка «Поделиться»: урок можно открыть и выполнить без регистрации, ответы не сохраняются. */
export default async function Share({ params }: { params: Promise<{ token: string }> }) {
  const { t } = await getT();
  const l = await db.lessonTemplate.findUnique({ where: { shareToken: (await params).token }, select: { id: true, shareOn: true } });
  if (!l || !l.shareOn) {
    return (
      <AuthShell>
        <section className="authcard text-center"><h1>{t("shr.off")}</h1><p className="muted">{t("shr.offText")}</p></section>
      </AuthShell>
    );
  }
  const data = await loadLesson(l.id);
  if (!data) notFound();
  const g = ordered(data.rubrics, data.tasks);
  return <ShareView title={data.l.title} course={data.l.unit.course.title} groups={g.lesson} homework={g.homework} words={g.words} />;
}
