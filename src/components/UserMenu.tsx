"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { logoutAction } from "@/lib/auth/actions";
import { useT } from "@/lib/i18n/client";
import { Icon } from "./Icon";
import { StudentAvatar } from "./awards/Medal";
import type { Cabinet } from "./CabinetSwitch";
import { switchCabinet } from "@/lib/admin/actions";
import { openStudentCabinet } from "@/lib/teacher/demo";

export function UserMenu({ name, lastName, email, profileHref, avatar, cabinets, linked, asStudent }: { name: string; lastName?: string | null; email: string; profileHref: string; avatar?: { id: string; avatar: string | null; crown: boolean }; cabinets?: Cabinet[]; linked?: { label: string; email: string } | null; asStudent?: boolean }) {
  const { t } = useT();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && ref.current.removeAttribute("open");
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const initials = ((name[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase();
  return (
    <details className="umenu" ref={ref}>
      <summary className="atuser" aria-label={t("common.profile")}>
        {avatar ? <StudentAvatar id={avatar.id} avatar={avatar.avatar} size={32} crown={avatar.crown} /> : <span className="avatar">{initials}</span>}
        <span className="uname">{name}</span>
      </summary>
      <div className="pop">
        <div className="who">
          {t("menu.signedAs")}
          <b>{[name, lastName].filter(Boolean).join(" ")}</b>
          {email}
        </div>
        {/* переключение кабинетов — здесь же, чтобы было и на телефоне */}
        {cabinets?.filter((c) => !c.current).map((c) => (
          <Link key={c.href} href={c.href} className="umcab" onClick={() => ref.current?.removeAttribute("open")}><Icon name="shift" />{c.label}</Link>
        ))}
        {linked && <button type="button" className="umcab" onClick={async () => { const r = await switchCabinet(); if (r.ok) window.location.href = r.href; }}><Icon name="shift" />{linked.label}</button>}
        {/* учитель без второго кабинета: посмотреть всё глазами ученика (создаётся тестовый ученик) */}
        {asStudent && !linked && <button type="button" className="umcab" onClick={async () => { const r = await openStudentCabinet(); if (r.ok) window.location.href = r.href; }}><Icon name="eye" />{t("demo.menu")}</button>}
        <Link href={profileHref} onClick={() => ref.current?.removeAttribute("open")}>
          <Icon name="user" />
          {t("common.profile")}
        </Link>
        <form action={logoutAction}>
          <button type="submit" className="danger">
            <Icon name="logout" />
            {t("common.logout")}
          </button>
        </form>
      </div>
    </details>
  );
}
