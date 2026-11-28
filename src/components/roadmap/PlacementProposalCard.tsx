"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { sylTopic } from "@/lib/grammar/syllabus";
import { confirmPlacementProposal } from "@/lib/roadmap/placement-proposal-actions";
import type { PlacementProposal } from "@/lib/roadmap/placement-proposal-data";
import { SKILLS, SKILL_NAME, txt } from "@/lib/roadmap/cefr";

const labels = {
  ru: {
    title: "Предложение по маршруту",
    noResult: "Ожидаем подтверждённый результат Placement Test с версией и источниками данных.",
    routeStatus: "Действующий маршрут утверждён и виден ученику.",
    source: "Подтверждённый результат Placement Test",
    unknown: "Что пока неизвестно",
    missing: "Без подтверждённых данных",
    evidence: "Почему меняется порядок",
    preserved: "Начатые и завершённые уроки, накопленный прогресс и текущий срез сохраняются.",
    verified: "Подтверждённые навыки",
    description: "Темы с подтверждёнными пробелами предлагается пройти раньше в пределах будущего этапа.",
    before: "Сейчас", after: "Предлагается", stage: "Этап",
    empty: "Подтверждённые данные не дают оснований менять порядок будущих тем.",
    ambiguous: "Связь тем или контрольных точек с этапами требует уточнения.",
    confirm: "Подтвердить изменения будущих тем",
    applied: "Порядок будущих тем обновлён.",
    stale: "Результат диагностики или маршрут изменился. Проверьте обновлённое предложение.",
    error: "Не удалось подтвердить изменения. Попробуйте ещё раз.",
    verdict: { gap: "пробел", partial: "зона роста", secure: "уверенное выполнение" },
    scope: { initial: "вводная диагностика", additional: "дополнительная диагностика", reassessment: "переоценка", "teacher-adjustment": "зачёт преподавателя" },
    reason: { "not-tested": "не проверено", "not-confirmed": "результат не подтверждён", "unknown-origin": "источник не установлен" },
  },
  en: {
    title: "Suggested route update",
    noResult: "Waiting for a confirmed Placement Test result with a version and evidence sources.",
    routeStatus: "The approved route is visible to the student.",
    source: "Confirmed Placement Test result",
    unknown: "What we do not know yet",
    missing: "No confirmed evidence",
    evidence: "Why the order changes",
    preserved: "Started and completed lessons, recorded progress and the current checkpoint are preserved.",
    verified: "Confirmed skills",
    description: "Topics with confirmed gaps are prioritised within a future stage.",
    before: "Current order", after: "Suggested order", stage: "Stage",
    empty: "The confirmed evidence does not warrant reordering any future topics.",
    ambiguous: "Some topics or checkpoints cannot be reliably linked to a stage.",
    confirm: "Confirm changes to future topics",
    applied: "The order of future topics was updated.",
    stale: "The diagnostic result or route changed. Review the updated proposal.",
    error: "The update could not be confirmed. Try again.",
    verdict: { gap: "gap", partial: "room to improve", secure: "strong performance" },
    scope: { initial: "initial assessment", additional: "additional assessment", reassessment: "reassessment", "teacher-adjustment": "teacher adjustment" },
    reason: { "not-tested": "not tested", "not-confirmed": "result not confirmed", "unknown-origin": "source unknown" },
  },
};

export function PlacementProposalCard({ preview, studentId, roadmapId }: {
  preview: PlacementProposal | null;
  studentId: string;
  roadmapId: string;
}) {
  const { lang } = useT();
  const t = labels[lang];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: "applied" | "stale" | "error"; before: string } | null>(null);
  const topicName = (id: string) => sylTopic(id)?.[lang] ?? id;
  const source = preview?.source;
  const unknownSkills = SKILLS.flatMap((skill) => {
    const fact = source?.skills.find((entry) => entry.skill === skill);
    if (fact?.status === "checked") return [];
    return [`${txt(SKILL_NAME[skill], lang)} — ${fact ? t.reason[fact.reason] : t.missing}`];
  });
  const unknownTopics = source?.topics.flatMap((fact) => fact.status === "unknown"
    ? [`${topicName(fact.topicId)} — ${t.reason[fact.reason]}`] : []) ?? [];
  const markedUnknown = new Set(source?.topics.flatMap((fact) => fact.status === "unknown"
    ? [sylTopic(fact.topicId)?.id ?? fact.topicId] : []));
  const unlistedPoints = preview?.unknownPoints.filter(({ topicIds }) => !topicIds.length || topicIds.some((id) => !markedUnknown.has(id))) ?? [];
  const unknown = [...new Set([...unknownTopics, ...unknownSkills, ...unlistedPoints.map(({ title }) => `${title} — ${t.missing}`)])];
  const feedbackForCurrent = feedback?.before === preview?.confirmation.before ? feedback?.kind : null;
  const currentFeedback = feedback?.kind === "stale" ? "stale" : feedbackForCurrent;
  const submit = () => {
    if (!preview?.changes.length) return;
    start(async () => {
      try {
        const outcome = await confirmPlacementProposal(studentId, roadmapId, preview.confirmation);
        setFeedback({ kind: outcome === "stale" ? "stale" : "applied",
          before: outcome === "stale" ? preview.confirmation.before : preview.confirmation.after });
        router.refresh();
      } catch {
        setFeedback({ kind: "error", before: preview.confirmation.before });
      }
    });
  };
  return (
    <section className="card flex flex-col gap-4" aria-labelledby="placement-route-proposal">
      <div>
        <h3 className="m-0" id="placement-route-proposal">{t.title}</h3>
        <p className="small muted mt-1 mb-0">{t.routeStatus}</p>
      </div>
      {!source || !preview ? <p className="m-0 hint">{t.noResult}</p> : <>
        <div className="small">
          <Link href={`/teacher/placement/${encodeURIComponent(source.attemptId)}`} className="alink">{t.source}</Link>
          <span className="muted" title={source.version}> · {source.level} · {new Date(source.confirmedAt).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { timeZone: "UTC" })}</span>
        </div>
        {preview.changes.length > 0 ? <p className="small m-0">{t.description} {t.preserved}</p> : !currentFeedback &&
          <p className="small m-0">{preview.ambiguous ? t.ambiguous : t.empty}</p>}
        {preview.changes.map(({ stage, before, after, moved }) => (
          <div key={stage} className="rounded-xl border border-sep p-3 flex flex-col gap-3">
            <h4 className="m-0">{t.stage} {stage + 1}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([[t.before, before], [t.after, after]] as const).map(([label, items]) => (
                <div key={label} className="min-w-0">
                  <b className="small muted">{label}</b>
                  <ol className="mt-1 mb-0 pl-5 list-decimal">{items.map((item, i) => <li key={i} className="break-words">{item}</li>)}</ol>
                </div>
              ))}
            </div>
            <div>
              <b className="small">{t.evidence}</b>
              <ul className="small mt-1 mb-0 pl-5 list-disc">
                {moved.map(({ title, from, to, facts }) => <li key={from}>
                  <b>{from} → {to} · {title}</b>
                  <ul className="m-0 pl-4">
                    {facts.map((fact) => <li key={fact.topicId}>{topicName(fact.topicId)} · {fact.correct}/{fact.total} · {t.verdict[fact.verdict]} · {t.scope[fact.provenance.scope]}</li>)}
                  </ul>
                </li>)}
              </ul>
            </div>
          </div>
        ))}
        {source.skills.some((fact) => fact.status === "checked") && <div className="small">
          <b>{t.verified}</b>
          <ul className="mt-1 mb-0 pl-5 list-disc">
            {source.skills.map((fact) => fact.status === "checked" && <li key={fact.skill}>{txt(SKILL_NAME[fact.skill], lang)} · {fact.level} · {t.scope[fact.provenance.scope]}</li>)}
          </ul>
        </div>}
        {unknown.length > 0 && <div className="small">
          <b>{t.unknown}</b>
          <ul className="mt-1 mb-0 pl-5 list-disc">
            {unknown.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>}
        {preview.changes.length > 0 && (
          <div><button className="btn primary" type="button" onClick={submit} disabled={pending || feedbackForCurrent === "stale"}>{t.confirm}</button></div>
        )}
      </>}
      <div role="status" className={currentFeedback && currentFeedback !== "applied" ? "small text-bad empty:hidden" : "small empty:hidden"}>
        {currentFeedback && t[currentFeedback]}
      </div>
    </section>
  );
}
