"use client";
import { useRef, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { AUDIENCE, SPECS, aboutFilled, yearsOf, type TeacherAbout } from "@/lib/teacher/about-data";
import { saveTeacherAbout } from "@/lib/teacher/about";
import { upload } from "../courses/CourseView";
import { Icon } from "../Icon";

const initials = (n: string) => n.split(" ").map((x) => x[0] ?? "").join("").slice(0, 2).toUpperCase();

/** Карточка преподавателя — так её видит ученик. */
export function TeacherCard({ name, a }: { name: string; a: TeacherAbout }) {
  const { t } = useT();
  const years = yearsOf(a.since);
  const facts = [
    years > 0 && { k: t("ta.f.years"), v: t("ta.yearsN", { n: years }) },
    a.ownLevel && { k: t("ta.f.ownLevel"), v: a.ownLevel },
    a.levels && { k: t("ta.f.levels"), v: a.levels },
    a.languages && { k: t("ta.f.languages"), v: a.languages },
  ].filter(Boolean) as { k: string; v: string }[];
  const sec = (k: DictKey, v?: string) => v ? <section className="tcard-sec"><h3>{t(k)}</h3><p>{v}</p></section> : null;
  return (
    <article className="tcard">
      <header className="tcard-hd">
        {a.photo ? <img className="tcard-ph" src={a.photo} alt="" /> : <span className="tcard-ph tcard-ini">{initials(name)}</span>}
        <div className="min-w-0">
          <h2 className="m-0">{name}</h2>
          {a.headline && <p className="tcard-hl">{a.headline}</p>}
          {(a.specs?.length || a.audience?.length) ? (
            <div className="tcard-chips">
              {a.specs?.map((s) => <span key={s} className="pill blue">{t(`ta.spec.${s}` as DictKey)}</span>)}
              {a.audience?.map((s) => <span key={s} className="pill violet">{t(`ta.aud.${s}` as DictKey)}</span>)}
            </div>
          ) : null}
        </div>
      </header>
      {facts.length > 0 && <dl className="tcard-facts">{facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}</dl>}
      {sec("ta.f.bio", a.bio)}
      {a.certs?.length ? <section className="tcard-sec"><h3>{t("ta.f.certs")}</h3><ul className="tcard-certs">{a.certs.map((c) => <li key={c}><Icon name="check" size="sm" />{c}</li>)}</ul></section> : null}
      {sec("ta.f.education", a.education)}
      {sec("ta.f.experience", a.experience)}
      {sec("ta.f.approach", a.approach)}
      {sec("ta.f.format", a.format)}
      {sec("ta.f.results", a.results)}
      {sec("ta.f.interests", a.interests)}
      {(a.video || a.links) && (
        <section className="tcard-sec"><h3>{t("ta.f.more")}</h3>
          <div className="flex flex-col gap-1.5">
            {a.video && <a className="alink" href={a.video} target="_blank" rel="noreferrer"><Icon name="video" size="sm" /> {t("ta.video")}</a>}
            {a.links?.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => /^https?:\/\//.test(l) ? <a key={l} className="alink" href={l} target="_blank" rel="noreferrer">{l.replace(/^https?:\/\//, "")}</a> : <span key={l}>{l}</span>)}
          </div>
        </section>
      )}
    </article>
  );
}

/** Анкета преподавателя в профиле учителя: заполнить и посмотреть, как увидит ученик. */
export function TeacherAboutForm({ name, init }: { name: string; init: TeacherAbout }) {
  const { t } = useT();
  const [a, setA] = useState<TeacherAbout>({ show: true, ...init });
  const [cert, setCert] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<TeacherAbout>) => { setA((x) => ({ ...x, ...p })); setMsg(null); };
  const toggle = (k: "specs" | "audience", v: string) => set({ [k]: (a[k] ?? []).includes(v) ? (a[k] ?? []).filter((x) => x !== v) : [...(a[k] ?? []), v] });
  const addCert = () => { const v = cert.trim(); if (v && !(a.certs ?? []).includes(v)) set({ certs: [...(a.certs ?? []), v] }); setCert(""); };
  const save = () => start(async () => { const r = await saveTeacherAbout(a).catch(() => null); setMsg(r?.ok ? `✓ ${t("common.saved")}` : t("pl.err.net")); });
  const text = (k: keyof TeacherAbout, label: DictKey, ph: DictKey, rows = 3) => (
    <label className="field"><span className="flabel">{t(label)}</span><textarea className="textarea" rows={rows} value={(a[k] as string) ?? ""} placeholder={t(ph)} onChange={(e) => set({ [k]: e.target.value })} /></label>
  );
  const line = (k: keyof TeacherAbout, label: DictKey, ph: DictKey, max?: number) => (
    <label className="field"><span className="flabel">{t(label)}</span><input className="input" value={(a[k] as string) ?? ""} placeholder={t(ph)} maxLength={max} onChange={(e) => set({ [k]: e.target.value })} /></label>
  );
  return (
    <section className="card" id="about">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 grow">{t("ta.title")}</h2>
        <button type="button" className="btn plain sm" onClick={() => setPreview(!preview)}><Icon name="eye" size="sm" />{preview ? t("ta.edit") : t("ta.preview")}</button>
      </div>
      <p className="small muted mt-1">{t("ta.lead")}</p>
      {preview ? (
        <div className="mt-3">{aboutFilled(a) ? <TeacherCard name={name} a={a} /> : <p className="hint m-0">{t("ta.emptyPreview")}</p>}</div>
      ) : (
        <div className="flex flex-col gap-4 mt-3">
          <div className="ta-photo">
            {a.photo ? <img src={a.photo} alt="" className="tcard-ph" /> : <span className="tcard-ph tcard-ini">{initials(name)}</span>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn secondary sm" onClick={() => fileRef.current?.click()}><Icon name="image" size="sm" />{a.photo ? t("ta.photoChange") : t("ta.photoAdd")}</button>
              {a.photo && <button type="button" className="btn plain sm" onClick={() => set({ photo: undefined })}>{t("common.delete")}</button>}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = await upload(f).catch(() => null); if (r?.url) set({ photo: r.url }); }} />
            </div>
          </div>
          {line("headline", "ta.f.headline", "ta.ph.headline", 140)}
          {text("bio", "ta.f.bio", "ta.ph.bio", 4)}
          <div className="grid gap-3 sm:grid-cols-3">
            {line("since", "ta.f.since", "ta.ph.since", 4)}
            {line("ownLevel", "ta.f.ownLevel", "ta.ph.ownLevel", 20)}
            {line("levels", "ta.f.levels", "ta.ph.levels", 40)}
          </div>
          <div className="field"><span className="flabel">{t("ta.f.specs")}</span>
            <div className="flex flex-wrap gap-2">{SPECS.map((s) => <button key={s} type="button" className={`pchip ${(a.specs ?? []).includes(s) ? "on" : ""}`} aria-pressed={(a.specs ?? []).includes(s)} onClick={() => toggle("specs", s)}>{t(`ta.spec.${s}` as DictKey)}</button>)}</div>
          </div>
          <div className="field"><span className="flabel">{t("ta.f.audience")}</span>
            <div className="flex flex-wrap gap-2">{AUDIENCE.map((s) => <button key={s} type="button" className={`pchip ${(a.audience ?? []).includes(s) ? "on" : ""}`} aria-pressed={(a.audience ?? []).includes(s)} onClick={() => toggle("audience", s)}>{t(`ta.aud.${s}` as DictKey)}</button>)}</div>
          </div>
          <div className="field"><span className="flabel">{t("ta.f.certs")}</span>
            {(a.certs?.length ?? 0) > 0 && <div className="flex flex-wrap gap-2 mb-2">{a.certs!.map((c) => <span key={c} className="pill grey">{c}<button type="button" className="plain" aria-label={t("common.delete")} onClick={() => set({ certs: a.certs!.filter((x) => x !== c) })}><Icon name="close" size="sm" /></button></span>)}</div>}
            <div className="flex gap-2"><input className="input grow" value={cert} placeholder={t("ta.ph.certs")} onChange={(e) => setCert(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCert(); } }} maxLength={80} />
              <button type="button" className="btn secondary" disabled={!cert.trim()} onClick={addCert}><Icon name="plus" size="sm" />{t("ta.add")}</button></div>
          </div>
          {text("education", "ta.f.education", "ta.ph.education")}
          {text("experience", "ta.f.experience", "ta.ph.experience")}
          {text("approach", "ta.f.approach", "ta.ph.approach", 4)}
          {text("format", "ta.f.format", "ta.ph.format")}
          {text("results", "ta.f.results", "ta.ph.results")}
          <div className="grid gap-3 sm:grid-cols-2">
            {line("languages", "ta.f.languages", "ta.ph.languages")}
            {line("video", "ta.f.video", "ta.ph.video")}
          </div>
          {text("interests", "ta.f.interests", "ta.ph.interests", 2)}
          {text("links", "ta.f.links", "ta.ph.links", 2)}
          <label className="setting"><span>{t("ta.show")}<span className="small muted block">{t("ta.showHint")}</span></span>
            <span className="switch"><input type="checkbox" checked={a.show !== false} onChange={(e) => set({ show: e.target.checked })} /><span /></span></label>
        </div>
      )}
      <div className="actions">
        {msg && <span className="small muted mr-auto">{msg}</span>}
        <button type="button" className="btn primary" disabled={pending} onClick={save}>{t("common.save")}</button>
      </div>
    </section>
  );
}
