import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";

export type LegalSection = { h: string; p: (string | string[])[] };

/** Юридический документ: заголовок, дата редакции, разделы с абзацами и списками. */
export function LegalDoc({ title, updated, intro, sections, other }: { title: string; updated: string; intro: string; sections: LegalSection[]; other: { href: string; label: string } }) {
  return (
    <AuthShell wordmark={false}>
      <article className="authcard legal">
        <h1>{title}</h1>
        <p className="small muted text-center mt-2">Редакция от {updated}</p>
        <p>{intro}</p>
        {sections.map((s, i) => (
          <section key={i}>
            <h2>{i + 1}. {s.h}</h2>
            {s.p.map((x, j) => (Array.isArray(x) ? <ul key={j}>{x.map((li, k) => <li key={k}>{li}</li>)}</ul> : <p key={j}>{x}</p>))}
          </section>
        ))}
        <p className="small muted mt-6 mb-0">
          См. также: <Link className="alink" href={other.href}>{other.label}</Link> · <Link className="alink" href="/">VibeOn</Link>
        </p>
      </article>
    </AuthShell>
  );
}
