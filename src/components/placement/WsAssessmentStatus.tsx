import { translate, type LangCode } from "@/lib/i18n/dict";
import type { PState } from "@/lib/placement/engine";
import { RUB_V1, RUB_V2 } from "@/lib/placement/rubric";
import { readWsAssessment, wsAssessmentSource } from "@/lib/placement/ws-assessment";

type Skill = "writing" | "speaking";
type ScoreDetails = { marks: Record<string, number | null>; comments?: Record<string, string>; note?: string };
type DatedScore = ScoreDetails & { at: string };

export function wsAssessmentView(state: PState, review: Record<string, unknown>, kind: Skill) {
  const { draft, confirmation, staleConfirmation, history, request } =
    readWsAssessment(review, wsAssessmentSource(state, kind, RUB_V2));
  const confirmationDetails = ({ marks, comments, note, at }: DatedScore): DatedScore => ({ marks, comments, note, at });
  return {
    draft: draft && { at: draft.at, marks: draft.score.scores, comments: draft.score.why, note: draft.score.summary },
    confirmation: confirmation && confirmationDetails(confirmation),
    stale: !!staleConfirmation,
    history: history.map(({ generation, reason, confirmation: previous }) => ({ generation, reason, score: confirmationDetails(previous) })),
    requestStatus: request?.status === "pending" || request?.status === "failed" ? request.status : null,
  };
}

export function WsAssessmentStatus({ kind, view, lang, timeZone }: {
  kind: Skill;
  view: ReturnType<typeof wsAssessmentView>;
  lang: LangCode;
  timeZone: string;
}) {
  const { draft, confirmation, stale, history, requestStatus } = view;
  if (!draft && !confirmation && !history.length && !requestStatus) return null;

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const labels = new Map([...RUB_V1[kind], ...RUB_V2[kind]].map((c) => [c.id, lang === "en" ? c.en ?? c.name_ru : c.name_ru]));
  const formatter = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { dateStyle: "medium", timeZone });
  const date = (at: string) => {
    const value = Date.parse(at);
    return Number.isNaN(value) ? null : <time dateTime={at} className="small muted ml-2">{formatter.format(value)}</time>;
  };
  const details = ({ marks, comments, note }: ScoreDetails) => (
    <>
      <dl className="small m-0 flex flex-col gap-1">
        {Object.entries(marks).map(([id, value]) => (
          <div key={id}>
            <dt className="inline">{labels.get(id) ?? id}</dt>
            <dd className="inline m-0"> · <b>{value ?? "—"}</b>{comments?.[id] && <p className="m-0 whitespace-pre-line">{comments[id]}</p>}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="small m-0 whitespace-pre-line">{note}</p>}
    </>
  );

  return (
    <section className="plrub" aria-label={t(kind === "writing" ? "pl.wsWritingReview" : "pl.wsSpeakingReview")}>
      {requestStatus && <p className="small muted m-0">{t(requestStatus === "pending" ? "pl.aiChecking" : "pl.wsDraftFailed")}</p>}
      {draft && <details>
        <summary><b>{t("pl.wsAiDraft")}</b>{date(draft.at)}</summary>
        {details(draft)}
      </details>}
      {confirmation && <details>
        <summary><b>{t("pl.wsConfirmed")}</b>{date(confirmation.at)}</summary>
        {details(confirmation)}
      </details>}
      {stale && <p className="small muted m-0">{t("pl.wsStale")}</p>}
      {history.length > 0 && <details>
        <summary>{t("pl.wsHistory")}</summary>
        <ul className="small mb-0 flex flex-col gap-2">
          {history.slice().reverse().map(({ generation, reason, score }) => (
            <li key={generation}>
              <b>{t(reason === "reopened" ? "pl.wsReopened" : "pl.wsPreviousVersion")}</b>{date(score.at)}
              {details(score)}
            </li>
          ))}
        </ul>
      </details>}
    </section>
  );
}
