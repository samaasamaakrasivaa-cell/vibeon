"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "../Icon";
import { Dialog } from "../Dialog";
import { InviteForm } from "./InviteForm";
import { useT } from "@/lib/i18n/client";

export type Card = { id: string; name: string; sub: string; initials: string; color: number; href: string; badge?: string };
const COLORS = [
  ["var(--accent-bg)", "var(--accent-text)"], ["var(--ok-bg)", "var(--ok-text)"], ["var(--bad-bg)", "var(--bad-text)"],
  ["var(--warn-bg)", "var(--warn-text)"], ["var(--violet-bg)", "var(--violet)"], ["#E0F7F8", "#0B7480"],
];
export const avatarStyle = (i: number) => ({ background: COLORS[i % COLORS.length][0], color: COLORS[i % COLORS.length][1] });

/** Поиск по имени в шапке страницы — фильтрует карточки на месте. */
export function StudentsGrid({ cards, invite, empty }: { cards: Card[]; invite?: boolean; empty: string }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = cards.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {invite ? (
          <button type="button" className="invitecard" onClick={() => setOpen(true)}>
            <span className="ico"><Icon name="plus" /></span>
            <span><b>{t("inviteT.title")}</b><small>{t("stu.inviteSub")}</small></span>
          </button>
        ) : <span />}
        {cards.length > 0 && (
          <label className="searchbox">
            <Icon name="search" size="sm" />
            <input className="input" placeholder={t("stu.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("stu.search")} />
          </label>
        )}
      </div>
      {cards.length === 0 ? (
        <div className="card"><p className="hint m-0">{empty}</p></div>
      ) : (
        <div className="grid-3">
          {list.map((c) => (
            <Link key={c.id} href={c.href} className="scard">
              <span className="avatar lg" style={avatarStyle(c.color)}>{c.initials}</span>
              <span className="grow"><b>{c.name}</b><span>{c.sub}</span></span>
              {c.badge && <span className="pill grey">{c.badge}</span>}
              <Icon name="right" size="sm" className="text-text3" />
            </Link>
          ))}
          {list.length === 0 && <p className="hint">{t("stu.nothing")}</p>}
        </div>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t("inviteT.title")} wide>
        <p className="muted mt-0">{t("stu.inviteLead")}</p>
        <InviteForm />
      </Dialog>
    </>
  );
}
