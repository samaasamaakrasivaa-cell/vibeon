"use client";
import Link from "next/link";
import { useState } from "react";
import { switchCabinet } from "@/lib/admin/actions";
import { useT } from "@/lib/i18n/client";
import { Icon } from "../Icon";

type Role = "TEACHER" | "STUDENT";

/** Две большие кнопки: кабинет ученика и кабинет учителя. Во второй переходим без повторного входа. */
export function ChooseCabinet({ mine, other }: { mine: { role: Role; href: string }; other: { role: Role }; who: string }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const card = (role: Role) => (
    <>
      <span className="chc-ic"><Icon name={role === "TEACHER" ? "book" : "home"} /></span>
      <span className="grow"><b className="block">{t(role === "TEACHER" ? "ws.teacher" : "ws.student")}</b><span className="small muted">{t(role === "TEACHER" ? "ch.teacherSub" : "ch.studentSub")}</span></span>
      <Icon name="right" size="sm" />
    </>
  );
  const list = [mine.role, other.role].sort((a) => (a === "STUDENT" ? -1 : 1)); // ученик сверху, учитель снизу
  return (
    <div className="flex flex-col gap-3">
      {list.map((role) => role === mine.role
        ? <Link key={role} href={mine.href} className="chc" data-role={role}>{card(role)}</Link>
        : <button key={role} type="button" className="chc" data-role={role} disabled={busy} onClick={async () => { setBusy(true); const r = await switchCabinet(); if (r.ok) window.location.href = r.href; else setBusy(false); }}>{card(role)}</button>)}
      <p className="small muted m-0 text-center">{t("ch.note")}</p>
    </div>
  );
}
