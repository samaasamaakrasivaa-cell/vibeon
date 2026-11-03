"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { logoutAction } from "@/lib/auth/actions";
import { useT } from "@/lib/i18n/client";
import { Icon } from "./Icon";

export function UserMenu({ name, lastName, email, profileHref }: { name: string; lastName?: string | null; email: string; profileHref: string }) {
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
        <span className="avatar">{initials}</span>
        <span className="uname">{name}</span>
      </summary>
      <div className="pop">
        <div className="who">
          {t("menu.signedAs")}
          <b>{[name, lastName].filter(Boolean).join(" ")}</b>
          {email}
        </div>
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
