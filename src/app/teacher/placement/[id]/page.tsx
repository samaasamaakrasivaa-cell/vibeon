import Link from "next/link";
import { notFound } from "next/navigation";
import { PlacementReview } from "@/components/placement/PlacementReview";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { RSaved } from "@/lib/placement/report";
import { getT } from "@/lib/i18n/server";
import { getBank, RUBRICS, trackOf } from "@/lib/placement/bank";
import { teacherReview } from "@/lib/placement/teacher-review";
import { PL_LEVELS, STEPS, summarize } from "@/lib/placement/engine";
import { reviewData } from "@/lib/placement/review";
import { doneOf, partsOf, stateOf } from "@/lib/placement/run";
import { PlacementParts } from "@/components/placement/AssignParts";

export const metadata = { title: "Placement test — проверка" };

export default async function PlacementReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, lang } = await getT();
  const me = await requireUser("TEACHER");
  const { id } = await params;
  const a = await db.placementAttempt.findUnique({ where: { id }, include: { student: true } });
  if (!a || a.teacherId !== me.id) notFound();
  const st = stateOf(a.state);
  const { bank } = await getBank(trackOf(st.track));
  const sm = summarize(st, bank);
  const d = reviewData(id, st, true);
  // говорение на уроке: вопросы уровнем выше и ниже из заданий, которых ученик не видел
  const spLevel = st.speaking ? (st.items[st.speaking.id] as { level?: string })?.level : null;
  const usedSp = new Set([st.speaking?.id, ...(st.wsPrev ?? []).map((x) => x.id)]);
  const lessonQs = spLevel ? [-1, 1].map((dlt) => PL_LEVELS[PL_LEVELS.indexOf(spLevel as never) + dlt]).filter(Boolean).map((lv) => ({
    level: lv as string,
    questions: bank.speaking.filter((x) => x.level === lv && !usedSp.has(x.id)).flatMap((x) => x.questions.map((q) => q.q)).slice(0, 3),
  })).filter((x) => x.questions.length) : [];
  const who = a.mode === "student" ? `${a.student?.name ?? ""} ${a.student?.lastName ?? ""}`.trim() : a.mode === "self" ? t("pl.you") : a.guestName ?? "";
  const loc = lang === "ru" ? "ru-RU" : "en-GB";
  const when = a.submittedAt ?? a.startedAt ?? a.createdAt;
  // разделы теста и даты: когда пройден каждый (тест можно дополнять разделами)
  const dfmt = (ms: number) => new Date(ms).toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: me.timezone });
  // отчёт уже собран (сохранён) или отправлен ученику — «Редактировать отчёт» вместо «Сгенерировать»
  const rep = ((a.review ?? {}) as { report?: RSaved }).report;
  const draft = teacherReview(a);
  const hasRep = !!(rep && (rep.sent || rep.student || rep.parent));
  const dates = Object.fromEntries(Object.entries(st.sdates ?? {}).map(([k, v]) => [k, dfmt(v as number)]));
  // даты прохождения: один день — «пройден 18 ноября»; разные — какие разделы когда и общий промежуток «18–20 ноября»
  const sd = Object.entries(st.sdates ?? {}).filter(([, v]) => typeof v === "number") as [string, number][];
  const dayOf = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: me.timezone });
  const days = [...new Set(sd.map(([, v]) => dayOf(v)))].sort();
  const longD = (ms: number, withMonth = true) => new Date(ms).toLocaleDateString(loc, { day: "numeric", ...(withMonth ? { month: "long" } : {}), timeZone: me.timezone });
  const firstMs = sd.length ? Math.min(...sd.map(([, v]) => v)) : when.getTime(), lastMs = sd.length ? Math.max(...sd.map(([, v]) => v)) : when.getTime();
  const sameMonth = new Date(firstMs).getMonth() === new Date(lastMs).getMonth();
  const doneLine = days.length > 1
    ? t("pl.doneRange", { d: sameMonth ? `${longD(firstMs, false)}–${longD(lastMs)}` : `${longD(firstMs)} – ${longD(lastMs)}` })
    : t("pl.doneOn", { d: longD(lastMs) });
  const byDay = days.length > 1 ? days.map((dd) => `${sd.filter(([, v]) => dayOf(v) === dd).map(([k]) => t(`pl.part.${k}` as "pl.part.core").toLowerCase()).join(", ")} — ${dfmt(sd.find(([, v]) => dayOf(v) === dd)![1])}`).join("; ") : null;
  const base = st.base !== undefined && !partsOf(st).includes("core") ? { sub: STEPS[st.base], from: st.baseFrom ?? "teacher" } : null;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <Link href="/teacher/courses?tab=tests" className="small muted">← {t("pl.backTests")}</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0">{t("pl.title")}: {who}</h1>
        <span className={`pill ${a.status === "reviewed" ? "green" : a.status === "submitted" ? "orange" : "grey"}`}>{t(`pl.st.${a.status}` as "pl.st.new")}</span>
        {(a.status === "submitted" || a.status === "reviewed") && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {rep?.sent && <span className="small muted">{t("pl.repSent", { d: rep.sentAt ? new Date(rep.sentAt).toLocaleDateString(loc, { day: "numeric", month: "long", timeZone: me.timezone }) : "" })}</span>}
            <Link href={`/teacher/placement/${id}/report`} className="btn primary sm">{t(hasRep ? "pl.editReport" : "pl.genReport")}</Link>
          </span>
        )}
      </div>
      <p className="muted mt-0 mb-5">
        {a.status === "submitted" || a.status === "reviewed" ? doneLine : when.toLocaleDateString(loc, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: me.timezone })}
        {byDay && <span className="block small mt-1">{byDay}</span>}
        {a.mode === "link" && a.guestContact ? ` · ${t("pl.contact")}: ${a.guestContact}` : ""}
        {a.mode === "student" && a.studentId ? <> · <Link className="alink" href={`/teacher/students/${a.studentId}?tab=roadmap`}>{t("pl.toProfile")}</Link></> : null}
      </p>
      {/* список разделов не нужен — даты выше; остаётся только «Добавить разделы» */}
      {a.mode === "student" && (a.status === "submitted" || a.status === "reviewed") && <div className="mb-5"><PlacementParts id={id} parts={partsOf(st)} done={doneOf(st)} dates={dates} canAdd compact /></div>}
      <div className="flex flex-col gap-6">
        <PlacementReview key={`${id}-${draft.regrading}-${st.writing?.id}-${st.speaking?.id}`} regrading={draft.regrading}
          parts={partsOf(st)} dates={dates} base={base} who={who} reveal={a.reveal}
          id={id} teen={st.track === "teen"} lessonQs={lessonQs} mode={a.mode} status={a.status} level={a.level} showResult={a.showResult} tgSent={((a.review ?? {}) as { tgSentAt?: string }).tgSentAt ? new Date(((a.review ?? {}) as { tgSentAt: string }).tgSentAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: me.timezone }) : null} sm={sm} d={d}
          review={draft.active as never}
          howTo={RUBRICS.how_to_decide_ru} sublevels={RUBRICS.sublevels_ru}
        />
      </div>
    </div>
  );
}
