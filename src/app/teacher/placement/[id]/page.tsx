import Link from "next/link";
import { notFound } from "next/navigation";
import { PlacementAnswers } from "@/components/placement/PlacementAnswers";
import { PlacementReview } from "@/components/placement/PlacementReview";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { getBank, RUBRICS } from "@/lib/placement/bank";
import { summarize } from "@/lib/placement/engine";
import { reviewData } from "@/lib/placement/review";
import { stateOf } from "@/lib/placement/run";

export const metadata = { title: "Вводный тест — проверка" };

export default async function PlacementReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const { id } = await params;
  const a = await db.placementAttempt.findUnique({ where: { id }, include: { student: true } });
  if (!a || a.teacherId !== me.id) notFound();
  const st = stateOf(a.state);
  const { bank } = await getBank();
  const sm = summarize(st, bank);
  const d = reviewData(id, st, true);
  const who = a.mode === "student" ? `${a.student?.name ?? ""} ${a.student?.lastName ?? ""}`.trim() : a.mode === "self" ? t("pl.you") : a.guestName ?? "";
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const when = a.submittedAt ?? a.startedAt ?? a.createdAt;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <Link href="/teacher/courses?tab=tests" className="small muted">← {t("pl.backTests")}</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0">{t("pl.title")}: {who}</h1>
        <span className={`pill ${a.status === "reviewed" ? "green" : a.status === "submitted" ? "orange" : "grey"}`}>{t(`pl.st.${a.status}` as "pl.st.new")}</span>
      </div>
      <p className="muted mt-0 mb-5">
        {when.toLocaleDateString(loc, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
        {a.mode === "link" && a.guestContact ? ` · ${t("pl.contact")}: ${a.guestContact}` : ""}
        {a.mode === "student" && a.studentId ? <> · <Link className="alink" href={`/teacher/students/${a.studentId}?tab=roadmap`}>{t("pl.toProfile")}</Link></> : null}
      </p>
      <div className="flex flex-col gap-6">
        <PlacementReview
          id={id} mode={a.mode} status={a.status} level={a.level} showResult={a.showResult} sm={sm} d={d}
          review={(a.review ?? {}) as never} rubrics={{ writing: RUBRICS.writing.criteria, speaking: RUBRICS.speaking.criteria }}
          howTo={RUBRICS.how_to_decide_ru} sublevels={RUBRICS.sublevels_ru} total={RUBRICS.total_ru}
        />
        {st.core.length > 0 && (
          <div>
            <h2 className="mb-1">{t("pl.answers")}</h2>
            <p className="small muted mt-0 mb-3">{a.mode === "student" ? t("pl.answersHint") : t("pl.answersHintOther")}</p>
            <PlacementAnswers id={id} d={d} teacher reveal={a.reveal} />
          </div>
        )}
      </div>
    </div>
  );
}
