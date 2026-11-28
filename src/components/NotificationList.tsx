"use client";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { dismissTeacherNotification } from "@/lib/notify/actions";
import { markAllRead, openNotification, setNotificationDone } from "@/lib/teacher/actions";
import { useT } from "@/lib/i18n/client";
import { Icon } from "./Icon";

export type Note = { id: string; title: string; when: string; unread: boolean; done: boolean; link: string | null; action: string | null };

const ACTION: Record<string, string> = { open_profile: "nt.open", reply: "nt.reply", check_screenshot: "nt.check", decide: "nt.decide", review: "nt.review", take: "nt.take" };

type Change = "read" | { id: string; done: boolean } | { dismiss: string };

export function NotificationList({ items, teacher = false }: { items: Note[]; teacher?: boolean }) {
  const { t } = useT();
  const [, start] = useTransition();
  const [dismissError, setDismissError] = useState(false);
  const [list, set] = useOptimistic(items, (cur, p: Change) => {
    if (p === "read") return cur.map((n) => ({ ...n, unread: false }));
    if ("dismiss" in p) return cur.filter((n) => n.id !== p.dismiss);
    return cur.map((n) => n.id === p.id ? { ...n, done: p.done, unread: false } : n);
  });
  function dismiss(id: string) {
    start(async () => {
      setDismissError(false);
      set({ dismiss: id });
      try {
        const result = await dismissTeacherNotification(id);
        setDismissError(!result.ok);
      } catch {
        setDismissError(true);
      }
    });
  }
  const unread = list.filter((n) => n.unread).length;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="whitespace-nowrap">{t("dash.whatsNew")}</h2>
        {unread > 0 && (
          <button className="btn plain sm" onClick={() => start(async () => { set("read"); await markAllRead(); })}>{t("nt.markAll")}</button>
        )}
      </div>
      {dismissError && <p className="alert" role="alert">{t("adm.err.fail")}</p>}
      {list.length === 0 ? <p className="hint m-0">{t("nt.empty")}</p> : (
        <div className="flex flex-col gap-1">
          {list.map((n) => (
            <div key={n.id} className={`nrow ${teacher ? "nrow-dismissible" : ""} ${n.unread ? "unread" : ""} ${n.done ? "done" : ""}`}>
              <input type="checkbox" className="check" checked={n.done} aria-label={t("nt.done")}
                onChange={(e) => { const done = e.target.checked; start(async () => { set({ id: n.id, done }); await setNotificationDone(n.id, done); }); }} />
              <div className="grow"><div className="t font-semibold">{n.title}</div><div className="small muted">{n.when}</div></div>
              {n.link && (
                <Link href={n.link} onClick={() => { const viewOnly = !n.action || n.action === "open_profile" || n.action === "open"; start(async () => { set({ id: n.id, done: viewOnly || n.done }); await openNotification(n.id); }); }}
                  className={teacher ? "nact btn secondary sm shrink-0" : "nact small inline-flex items-center gap-1 font-semibold whitespace-nowrap text-accent"}>
                  {t((ACTION[n.action ?? ""] ?? "nt.open") as never)} <Icon name="right" size="sm" />
                </Link>
              )}
              {teacher && <button type="button" className="iconbtn ndismiss" title={t("nt.dismiss")} aria-label={`${t("nt.dismiss")}: ${n.title}`} onClick={() => dismiss(n.id)}><Icon name="close" size="sm" /></button>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
