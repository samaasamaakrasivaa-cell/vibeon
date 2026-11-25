"use client";
// Метка задания в редакторе: тема (справочник), навык, уровень; «Определить с ИИ»; формулировка с темой одной кнопкой.
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { TAG_SKILLS, TOPICS, topicLabel, type TaskTags } from "@/lib/tasks/tags";
import { tagDraft } from "@/lib/tasks/tag-actions";
import { Icon } from "../Icon";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

export function TopicTag({ lessonId, task, tags, onTags, onTitle }: { lessonId: string; task: { type: string; title: string; content: string }; tags?: TaskTags; onTags: (t: TaskTags | undefined) => void; onTitle: (s: string) => void }) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const label = topicLabel(tags?.topic, tags?.topicName, lang);
  const ask = async () => {
    setBusy(true); setErr(null);
    const r = await tagDraft(lessonId, task).catch(() => ({ ok: false as const, error: t("ai.err.fail") }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onTags(r.tags ?? undefined);
  };
  const set = (p: Partial<TaskTags>) => onTags({ ...(tags ?? {}), ...p, by: "teacher" });
  return (
    <div className="ttag">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`ttag-chip ${label ? "" : "none"}`}><Icon name="target" size="sm" />{label ? <>{t("tg.topic")}: <b>{label}</b></> : t("tg.none")}{tags?.skill && <span className="muted"> · {t(`ss.k.${tags.skill}`)}</span>}{tags?.level && <span className="muted"> · {tags.level}</span>}{tags?.by === "ai" && <span className="ttag-ai">{t("tg.ai")}</span>}</span>
        <button type="button" className="btn plain sm" disabled={busy} onClick={ask}><Icon name="spark" size="sm" />{busy ? t("tg.busy") : label ? t("tg.again") : t("tg.ask")}</button>
        <button type="button" className="btn plain sm" onClick={() => setOpen((v) => !v)}><Icon name="pencil" size="sm" />{t("tg.edit")}</button>
      </div>
      {tags?.hint && tags.hint !== task.title.trim() && (
        <div className="rpf"><span className="small"><b>{t("tg.hintT")}</b> {tags.hint}</span><button type="button" className="btn plain sm" onClick={() => { onTitle(tags.hint!); onTags({ ...tags, hint: undefined }); }}>{t("tg.apply")}</button></div>
      )}
      {open && (
        <div className="ttag-edit">
          <select className="select xs" value={tags?.topic ?? ""} aria-label={t("tg.topic")} onChange={(e) => set({ topic: e.target.value || undefined, topicName: undefined })}>
            <option value="">{t("tg.pick")}</option>
            {LEVELS.map((L) => (
              <optgroup key={L} label={L}>{TOPICS.filter((x) => x.level === L).map((x) => <option key={x.topic_id} value={x.topic_id}>{lang === "en" ? x.topic_en : x.topic_ru}</option>)}</optgroup>
            ))}
          </select>
          <input className="input xs" value={tags?.topic ? "" : tags?.topicName ?? ""} placeholder={t("tg.own")} onChange={(e) => set({ topicName: e.target.value || undefined, topic: undefined })} />
          <select className="select xs" value={tags?.skill ?? ""} aria-label={t("tg.skill")} onChange={(e) => set({ skill: (e.target.value || undefined) as TaskTags["skill"] })}>
            <option value="">{t("tg.skill")}</option>{TAG_SKILLS.map((k) => <option key={k} value={k}>{t(`ss.k.${k}`)}</option>)}
          </select>
          <select className="select xs" value={tags?.level ?? ""} aria-label={t("tg.level")} onChange={(e) => set({ level: e.target.value || undefined })}>
            <option value="">{t("tg.level")}</option>{LEVELS.map((L) => <option key={L}>{L}</option>)}
          </select>
          {tags && <button type="button" className="btn plain sm" onClick={() => onTags(undefined)}>{t("tg.clear")}</button>}
        </div>
      )}
      {(tags?.words?.length ?? 0) > 0 && <div className="small muted">{t("tg.words")}: {tags!.words!.join(", ")}</div>}
      {(tags?.traps?.length ?? 0) > 0 && <div className="small muted">{t("tg.traps")}: {tags!.traps!.join("; ")}</div>}
      {err && <div className="alert">{err}</div>}
    </div>
  );
}
