import { AskForm, EscalateButton } from "@/components/student/AskForm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Вопросы" };

export default async function StudentQuestions() {
  const { t, lang } = await getT();
  const me = await requireUser("STUDENT");
  const s = await db.student.findUnique({ where: { userId: me.id } });
  if (!s) return null;
  const [qs, recent] = await Promise.all([
    db.question.findMany({ where: { studentId: s.id }, include: { task: { select: { title: true } } }, orderBy: { createdAt: "desc" } }),
    db.lessonInstance.findMany({ where: { studentId: s.id, templateId: { not: null }, startsAt: { lte: new Date() } }, include: { template: { include: { unit: { include: { course: true } } } } }, orderBy: { startsAt: "desc" }, take: 5 }),
  ]);
  const contexts = [...new Set(recent.map((l) => `${l.template!.unit.course.title} · ${l.template!.unit.title} · ${l.template!.title}`))];
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1 className="mb-1">{t("nav.questions")}</h1>
      <p className="muted mt-0 mb-5">{t("sq.lead")}</p>
      <AskForm contexts={contexts} />
      <section className="list mt-6">
        {qs.length === 0 && <p className="hint p-5 m-0">{t("sq.none")}</p>}
        {qs.map((q) => (
          <div key={q.id} className="qrow">
            <div className="grow">
              <div className="flex flex-wrap justify-between gap-2"><span className="small muted">{q.context ?? q.task?.title ?? t("sq.general")}</span><span className="small text-text3">{q.createdAt.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: me.timezone })}</span></div>
              <p className="mt-1 mb-0 font-semibold">{q.text}</p>
              {q.aiAnswer && <div className="aianswer mt-2"><b className="small">{t("ai.says")}</b><p className="m-0 mt-1">{q.aiAnswer}</p></div>}
              {q.teacherAnswer ? <div className="alert ok mt-2"><b className="block small">{t("cls.teacherSays")}</b>{q.teacherAnswer}</div> : q.askedTeacher ? <span className="pill orange mt-2 inline-flex">{t("sq.waiting")}</span> : <EscalateButton id={q.id} />}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
