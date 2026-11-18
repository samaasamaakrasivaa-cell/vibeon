"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { setStudentAvatar } from "@/lib/awards/actions";
import { CHARACTER_KEYS, CHARACTERS, CharacterArt } from "./Characters";
import { StudentAvatar } from "./Medal";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";

/** Анкета: аватарка ученика. Пока ученик не выбрал сам — учитель может поставить персонажа. */
export function TeacherAvatar({ id, avatar, crown, locked }: { id: string; avatar: string | null; crown: boolean; locked: boolean }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (v: string | null) => { setBusy(true); const r = await setStudentAvatar(id, v); setBusy(false); if (r.ok) { setOpen(false); router.refresh(); } };
  if (locked) return <span title={t("av.chosenByStudent")}><StudentAvatar id={id} avatar={avatar} size={64} crown={crown} /></span>;
  return (
    <>
      <button type="button" className="tavatar" title={t("av.teacherPick")} aria-label={t("av.teacherPick")} onClick={() => setOpen(true)}>
        <StudentAvatar id={id} avatar={avatar} size={64} crown={crown} />
        <span className="tavatar-ed" aria-hidden="true"><Icon name="pencil" size="sm" /></span>
      </button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title={t("av.teacherPick")}>
          <p className="hint mt-0">{t("av.teacherHint")}</p>
          <div className="avchars">
            {CHARACTER_KEYS.map((k) => (
              <button key={k} type="button" className={`avchar ${avatar === `char:${k}` ? "on" : ""}`} aria-pressed={avatar === `char:${k}`} disabled={busy} onClick={() => pick(`char:${k}`)}>
                <span className="avchar-img"><CharacterArt k={k} size={64} /></span>
                <span className="small">{CHARACTERS[k][lang === "en" ? "en" : "ru"]}</span>
              </button>
            ))}
          </div>
          <div className="actions">
            {avatar && <button type="button" className="btn plain" style={{ marginRight: "auto" }} disabled={busy} onClick={() => pick(null)}>{t("av.random")}</button>}
            <button type="button" className="btn secondary" onClick={() => setOpen(false)}>{t("common.close")}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
