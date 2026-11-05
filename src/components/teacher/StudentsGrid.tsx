"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteInvite } from "@/lib/teacher/actions";
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

/** Главная кнопка раздела: «Пригласить ученика» — окно со ссылкой. */
export function InviteButton({ openInvite }: { openInvite?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(!!openInvite); // ?invite=1 — сразу открыть «Пригласить ученика»
  return (
    <>
      <button type="button" className="invitecard wide" onClick={() => setOpen(true)}>
        <span className="ico"><Icon name="plus" /></span>
        <span className="grow"><b>{t("inviteT.title")}</b><small>{t("stu.inviteSub")}</small></span>
        <Icon name="right" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("inviteT.title")} wide>
        <p className="muted mt-0">{t("stu.inviteLead")}</p>
        <InviteForm />
      </Dialog>
    </>
  );
}

/** Зарегистрированные ученики: заголовок с числом, поиск по имени прямо над списком, карточки. */
export function StudentsGrid({ cards, empty, title }: { cards: Card[]; empty: string; title: string }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const list = cards.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section>
      <div className="secthead">
        <h2>{title} <span className="secnum">{cards.length}</span></h2>
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
    </section>
  );
}

/** Крестик у приглашения: удалить анкету-приглашение, ссылка сразу перестаёт работать. */
export function DeleteInvite({ id, name }: { id: string; name: string }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="iconbtn" disabled={pending} aria-label={t("inviteT.delete")} title={t("inviteT.delete")}
      onClick={() => { if (window.confirm(t("inviteT.deleteConfirm", { name }))) start(async () => { await deleteInvite(id); router.refresh(); }); }}>
      <Icon name="close" size="sm" />
    </button>
  );
}
