"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import type { IconName } from "./icon-paths";

export type NavItem = { href: string; label: string; icon: IconName; count?: number };

export function Sidebar({ groups, footer, ariaLabel }: { groups: NavItem[][]; footer?: React.ReactNode; ariaLabel: string }) {
  const path = usePathname();
  const base = groups[0]?.[0]?.href;
  const isActive = (href: string) => (href === base ? path === href : path === href || path.startsWith(href + "/"));
  return (
    <nav className="nav" aria-label={ariaLabel}>
      {groups.map((g, i) => (
        <div className="navgroup" key={i}>
          {g.map((it) => (
            <Link key={it.href} href={it.href} className="navb" data-tip={it.label} aria-current={isActive(it.href) ? "page" : undefined}>
              <Icon name={it.icon} />
              <span className="label">{it.label}</span>
              {!!it.count && <span className="count">{it.count}</span>}
            </Link>
          ))}
        </div>
      ))}
      {footer && <div className="navfoot">{footer}</div>}
    </nav>
  );
}
