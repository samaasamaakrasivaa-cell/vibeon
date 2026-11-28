"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { AnswerProvider } from "../tasks/store";
import { StudentCheck } from "../ai/AiReviewPanel";
import { AiCheckView } from "../ai/AiCheckView";
import { TaskCard, type TaskData } from "../tasks/TaskView";
import type { Review } from "./ClassRoom";

type Snapshot = { id: string; at: string; payload: Record<string, unknown>; review: Review | null };
type Revision = { revision: number; status: string; payload: Record<string, unknown>; archived: Snapshot[] };
const urlFor = (lessonId: string, taskId: string) => `/api/class/${lessonId}/homework/${taskId}`;

async function load(url: string): Promise<Revision> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw response.status;
  return response.json();
}

export function HomeworkHistory({ lessonId, task, teacher }: { lessonId: string; task: TaskData; teacher: boolean }) {
  const { t, lang } = useT();
  const [state, setState] = useState<Snapshot[] | "loading" | "error" | null>(null);
  async function open() {
    setState("loading");
    try { setState((await load(urlFor(lessonId, task.id))).archived); } catch { setState("error"); }
  }
  return (
    <details onToggle={(event) => { if (event.currentTarget.open && state === null) void open(); }} className="mt-2">
      <summary>{t("cls.hwRevision.history")}</summary>
      {state === "loading" && <p role="status">{t("cls.hwRevision.loading")}</p>}
      {state === "error" && <button type="button" className="btn secondary sm" onClick={open}>{t("cls.hwRevision.reload")}</button>}
      {Array.isArray(state) && state.map((snapshot) => (
        <details key={snapshot.id} className="mt-2">
          <summary>{new Date(snapshot.at).toLocaleString(lang)}</summary>
          <AnswerProvider answers={{ [task.id]: snapshot.payload }} onSet={() => {}} role={teacher ? "teacher" : "student"}>
            <fieldset disabled><TaskCard task={task} index={-1} /></fieldset>
          </AnswerProvider>
          {snapshot.review && <p>{t("cls.teacherSays")}: {snapshot.review.comment || t("cls.needsWork")}</p>}
          {snapshot.review?.ai2 ? <StudentCheck check={snapshot.review.ai2} /> : snapshot.review?.ai && <AiCheckView check={snapshot.review.ai} />}
        </details>
      ))}
    </details>
  );
}

export function HomeworkResubmission({ lessonId, taskId, active, card, onChange }: {
  lessonId: string; taskId: string; active: boolean; card: ReactNode; onChange: () => void;
}) {
  const { t } = useT();
  const url = urlFor(lessonId, taskId);
  const [state, setState] = useState<Revision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void load(url).then((value) => { if (current) setState((previous) => previous ?? value); }, () => { if (current) setError(0); });
    return () => { current = false; };
  }, [active, url]);

  const post = async (type: "start" | "save" | "submit", revision: number, payload?: Revision["payload"]) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, revision, payload }) });
    if (!response.ok) throw response.status;
    return (await response.json()).revision as number;
  };

  async function change(type: "start" | "save" | "submit" | "reload") {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (type === "reload") {
        setState(await load(url));
        onChange();
      } else if (type === "start") {
        await post("start", (await load(url)).revision);
        setState(await load(url));
        onChange();
      } else if (state?.status === "DRAFT") {
        const revision = await post("save", state.revision, state.payload);
        setState({ ...state, revision });
        if (type === "submit") {
          const submitted = await post("submit", revision);
          setState({ ...state, revision: submitted, status: "NEEDS_REVIEW" });
          onChange();
        } else setSaved(true);
      }
    } catch (failure) {
      setError(typeof failure === "number" ? failure : 0);
    } finally {
      setBusy(false);
    }
  }

  const editing = state?.status === "DRAFT";
  const submitted = state?.status === "NEEDS_REVIEW";
  return (
    <>
      <AnswerProvider answers={{ [taskId]: state?.payload ?? {} }} role="student" onSet={(_, key, value) => {
        setSaved(false);
        setState((current) => current && { ...current, payload: { ...current.payload, [key]: value } });
      }}>
        {state && (editing || submitted) && <fieldset disabled={busy || !editing}>{card}</fieldset>}
      </AnswerProvider>
      {!active && !editing && !submitted && <fieldset disabled>{card}</fieldset>}
      <div className="flex gap-2 mt-2">
        {editing && <>
          <button type="button" className="btn secondary sm" disabled={busy} onClick={() => change("save")}>{t("cls.hwRevision.save")}</button>
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => change("submit")}>{t("cls.hwRevision.submit")}</button>
        </>}
        {!editing && !submitted && !active && <button type="button" className="btn primary sm" disabled={busy} onClick={() => change("start")}>{t("cls.hwRevision.start")}</button>}
        {error !== null && error !== 422 && <button type="button" className="btn secondary sm" disabled={busy} onClick={() => change("reload")}>{t("cls.hwRevision.reload")}</button>}
      </div>
      {active && !state && error === null && <p role="status">{t("cls.hwRevision.loading")}</p>}
      {saved && <p role="status">{t("common.saved")}</p>}
      {submitted && <p role="status">{t("cls.hwRevision.submitted")}</p>}
      {error !== null && <p role="alert" className="text-bad">{t(error === 422 ? "cls.hwRevision.incomplete" : "cls.hwRevision.error")}</p>}
    </>
  );
}
