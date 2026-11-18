"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { Icon } from "../Icon";
import type { IconName } from "../icon-paths";

type Item = { id: string; title: string; topic: string; pinned: boolean; min: number; text: string };

/** База знаний: поиск, разделы карточками, статьи раздела списком. */
export function KbBrowser({ topics, items, base }: { topics: { key: string; name: string; icon: IconName }[]; items: Item[]; base: string }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const shown = topics.filter((k) => items.some((a) => a.topic === k.key));
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((a) => (s ? (a.title + " " + a.text).toLowerCase().includes(s) : topic ? a.topic === topic : true));
  }, [q, topic, items]);
  const popular = items.filter((a) => a.pinned).slice(0, 3);
  if (items.length === 0) return <section className="card"><p className="hint m-0">{t("pf.noKb")}</p></section>;
  return (
    <div className="kb">
      <div className="kbsearch"><Icon name="search" /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pf.search")} aria-label={t("pf.search")} /></div>
      {!q && popular.length > 0 && !topic && (
        <div className="kbpop">
          <span className="small muted">{t("pf.popular")}</span>
          {popular.map((a) => <Link key={a.id} href={`${base}/${a.id}`} className="pchip">{a.title}</Link>)}
        </div>
      )}
      {!q && (
        <div className="kbtopics">
          {shown.map((k) => (
            <button key={k.key} type="button" className={`kbtopic ${topic === k.key ? "on" : ""}`} aria-pressed={topic === k.key} onClick={() => setTopic(topic === k.key ? null : k.key)}>
              <span className="kbtopic-i"><Icon name={k.icon} /></span>
              <b>{k.name}</b>
              <span className="small muted">{t("pf.nArticles", { n: items.filter((a) => a.topic === k.key).length })}</span>
            </button>
          ))}
        </div>
      )}
      <section className="card p-0">
        {list.length === 0 ? <p className="hint m-0 p-5">{t("pf.notFound")}</p> : (
          <ul className="kblist">
            {list.map((a) => (
              <li key={a.id}><Link href={`${base}/${a.id}`}>
                <span className="grow min-w-0"><b>{a.title}</b><span className="small muted block">{topics.find((k) => k.key === a.topic)?.name} · {t("pf.min", { n: a.min })}</span></span>
                <Icon name="right" size="sm" />
              </Link></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
