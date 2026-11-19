"use client";
// Главная → «Сегодня»: у прошедшего урока — «Комментарий после урока». Текст сразу уходит в заметку к следующему уроку
// этого ученика (или группы) — открывать расписание не нужно.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { afterLessonNote } from "@/lib/teacher/actions";
import { Icon } from "../Icon";

export function AfterNote({ id, next }: { id: string; next: { date: string; note: string | null } | null }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(next?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!next) return <span className="small muted tl-nonext">{t("today.noNext")}</span>;
  if (!open) return (
    <button type="button" className="btn plain sm" onClick={() => setOpen(true)}>
      <Icon name="msg" size="sm" />{next.note ? t("today.afterEdit") : t("today.after")}
    </button>
  );
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await afterLessonNote(id, v);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setOpen(false); router.refresh();
  };
  return (
    <div className="afternote">
      <textarea className="textarea" rows={3} autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={t("today.afterPh")} aria-label={t("today.after")} />
      <span className="small muted">{t("today.afterTo", { d: next.date })}</span>
      <div className="flex gap-2">
        <button type="button" className="btn primary sm" disabled={busy} onClick={save}>{t("common.save")}</button>
        <button type="button" className="btn plain sm" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
      </div>
      {err && <span className="small text-bad">{err}</span>}
    </div>
  );
}
