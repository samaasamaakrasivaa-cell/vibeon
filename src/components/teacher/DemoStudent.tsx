"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { createDemoStudent, deleteDemoStudent } from "@/lib/teacher/demo";
import { switchCabinet } from "@/lib/admin/actions";
import { Icon } from "../Icon";

/** Профиль учителя: тестовый ученик — свой кабинет ученика, чтобы проверить, как всё выглядит у ученика. */
export function DemoStudent({ demo, blocked }: { demo: { studentId: string } | null; blocked: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { setBusy(true); const r = await switchCabinet(); if (r.ok) window.location.href = r.href; else setBusy(false); };
  return (
    <section className="card" id="demo">
      <h2 className="mb-1">{t("demo.title")}</h2>
      <p className="small muted mt-0">{t("demo.lead")}</p>
      {demo ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn primary" disabled={busy} onClick={go}><Icon name="user" size="sm" />{t("demo.open")}</button>
          <Link href={`/teacher/students/${demo.studentId}`} className="btn secondary">{t("demo.card")}</Link>
          <button type="button" className="btn plain sm ml-auto" disabled={busy} onClick={async () => { if (!confirm(t("demo.delQ"))) return; setBusy(true); await deleteDemoStudent(); setBusy(false); router.refresh(); }}>{t("demo.del")}</button>
        </div>
      ) : blocked ? <p className="hint m-0">{t("demo.blocked")}</p> : (
        <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); setErr(null); const r = await createDemoStudent(); setBusy(false); if (!r.ok) setErr(t("demo.blocked")); else router.refresh(); }}><Icon name="plus" size="sm" />{t("demo.create")}</button>
      )}
      {err && <div className="alert mt-2">{err}</div>}
      <p className="small muted mb-0 mt-3">{t("demo.how")}</p>
    </section>
  );
}
