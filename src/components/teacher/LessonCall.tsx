"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { setLessonCallLink } from "@/lib/teacher/actions";

export function LessonCall({ lessonId, href, canAdd }: { lessonId: string; href: string | null; canAdd: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();

  if (href) return <a href={href} className="btn secondary sm" target="_blank" rel="noreferrer"><Icon name="phone" size="sm" />{t("cls.joinCall")}</a>;
  if (!canAdd) return null;

  const close = () => setEditing(false);
  return (
    <>
      <button type="button" className="btn secondary sm" onClick={() => { setLink(""); setError(null); setEditing(true); }}><Icon name="phone" size="sm" />{t("cls.linkAdd")}</button>
      {editing && <Dialog open onClose={close} title={t("cls.linkAdd")}>
        <form onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            try {
              const result = await setLessonCallLink(lessonId, link);
              if (!result.ok) { setError(result.error); return; }
              setEditing(false);
              router.refresh();
            } catch {
              setError(t("sch.callSaveError"));
            }
          });
        }}>
          <label className="field">
            <span>{t("sch.callLink")}</span>
            <input className="input" inputMode="url" maxLength={500} autoFocus value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" />
          </label>
          {error && <p className="alert mt-3" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="btn secondary" onClick={close} disabled={pending}>{t("common.cancel")}</button>
            <button type="submit" className="btn primary" disabled={pending || !link.trim()}>{t("common.save")}</button>
          </div>
        </form>
      </Dialog>}
    </>
  );
}
