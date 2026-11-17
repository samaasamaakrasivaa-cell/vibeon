"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { setStudentField } from "@/lib/teacher/actions";
import { LEVELS } from "@/lib/roadmap/cefr";
import { TIMEZONES } from "@/lib/time";

export type InlineData = {
  id: string; email: string; phone: string; telegram: string; vk: string; socials?: string[]; timezone: string; callLink: string;
  courseId: string; courseText: string; level: string; interests: string; birthday: string; examGoal: string; startedAt: string; source: string; gender?: string;
};

const SOURCES: [string, string][] = [
  ["По рекомендации", "Recommendation"], ["Instagram", "Instagram"], ["Профи.ру", "Profi.ru"],
  ["ВКонтакте", "VK"], ["Telegram", "Telegram"], ["Авито", "Avito"], ["Сайт / поиск", "Website / search"], ["Бывший ученик", "Former student"],
];

/** Поле, которое правится прямо в карточке: нажали, вписали, ушли с поля — сохранилось. */
function Cell({ id, k, init, type = "text", placeholder, link, prefix }: { id: string; k: string; init: string; type?: string; placeholder?: string; link?: boolean; prefix?: string }) {
  const { t } = useT();
  const router = useRouter();
  // с префиксом (Telegram «@») в поле — только ник: «@» уже стоит и не дублируется при вставке
  const strip = (x: string) => (prefix === "@" ? x.trim().replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.me\//i, "").replace(/^@+/, "") : x);
  const [v, setV] = useState(strip(init));
  const [saved, setSaved] = useState(strip(init));
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  // данные поменялись в другом месте (окно «Изменить анкету») — показать новые
  useEffect(() => { setV(strip(init)); setSaved(strip(init)); }, [init]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    if (v.trim() === saved.trim()) return;
    start(async () => {
      const r = await setStudentField(id, k, v);
      if (r.ok) { setSaved(v); setErr(null); setOk(true); setTimeout(() => setOk(false), 1500); setTimeout(() => router.refresh(), 0); } else setErr(r.error);
    });
  };
  return (
    <div className="icell">
      <div className="flex items-center gap-2">
        {prefix ? <span className="iprefix"><span aria-hidden="true">{prefix}</span><input className="iedit" type={type} value={v} placeholder={placeholder ?? t("prof.addValue")} aria-label={k}
          onChange={(e) => setV(strip(e.target.value))} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(saved); (e.target as HTMLInputElement).blur(); } }} /></span> : <input className="iedit" type={type} value={v} placeholder={placeholder ?? t("prof.addValue")} aria-label={k}
          onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(saved); (e.target as HTMLInputElement).blur(); } }} />}
        {pending ? <span className="small text-text3">…</span> : ok ? <span className="small text-ok">✓</span> : link && saved && /^https?:\/\//.test(saved) ? <a className="small alink" href={saved} target="_blank" rel="noreferrer">↗</a> : null}
      </div>
      {err && <span className="small text-bad">{err}</span>}
    </div>
  );
}

/** Выбор из списка: сохраняется сразу. «Свой вариант» — поле для своего ответа. */
function Choice({ id, k, init, options, own }: { id: string; k: string; init: string; options: [string, string][]; own?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const inList = !init || options.some(([v]) => v === init);
  const [sel, setSel] = useState(inList ? init : "__own");
  const [text, setText] = useState(inList ? "" : init);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => { const l = !init || options.some(([v]) => v === init); setSel(l ? init : "__own"); setText(l ? "" : init); }, [init]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (val: string) => start(async () => { const r = await setStudentField(id, k, val); if (r.ok) { setOk(true); setTimeout(() => setOk(false), 1500); setTimeout(() => router.refresh(), 0); } });
  return (
    <div className="icell">
      <div className="flex items-center gap-2">
        <select className="iedit" value={sel} aria-label={k} onChange={(e) => { setSel(e.target.value); if (e.target.value !== "__own") save(e.target.value); }}>
          <option value="">{t("prof.notChosen")}</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {own && <option value="__own">{t("prof.ownVariant")}</option>}
        </select>
        {pending ? <span className="small text-text3">…</span> : ok ? <span className="small text-ok">✓</span> : null}
      </div>
      {sel === "__own" && <input className="iedit mt-1" value={text} placeholder={t("prof.ownVariantPh")} aria-label={`${k}-own`} autoFocus={!text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && save(text)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />}
    </div>
  );
}

/** Название сети по адресу — подписью у ссылки. */
const NETS: [RegExp, string][] = [[/vk\.(com|ru)|vkontakte/i, "VK"], [/instagram|instagr\.am/i, "Instagram"], [/facebook|fb\.com/i, "Facebook"], [/t\.me|telegram/i, "Telegram"], [/max\.ru/i, "Max"], [/linkedin/i, "LinkedIn"], [/tiktok/i, "TikTok"], [/youtube|youtu\.be/i, "YouTube"], [/ok\.ru/i, "OK"], [/(x|twitter)\.com/i, "X"], [/wa\.me|whatsapp/i, "WhatsApp"]];
const netOf = (u: string) => NETS.find(([r]) => r.test(u))?.[1] ?? null;
const hrefOf = (u: string) => (/^https?:\/\//i.test(u) ? u : /^[\w.-]+\.[a-z]{2,}\//i.test(u) ? `https://${u}` : null);

/** Другие соцсети: несколько ссылок, каждая — своей строкой; «+ Добавить соцсеть». */
function Socials({ id, init }: { id: string; init: string[] }) {
  const { t } = useT();
  const router = useRouter();
  const [list, setList] = useState<string[]>(init.length ? init : [""]);
  const [saved, setSaved] = useState(init.join("\n"));
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => { setList(init.length ? init : [""]); setSaved(init.join("\n")); }, [init.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (next: string[]) => {
    const clean = next.map((x) => x.trim()).filter(Boolean);
    if (clean.join("\n") === saved) return;
    start(async () => {
      const r = await setStudentField(id, "socials", JSON.stringify(clean));
      if (r.ok) { setSaved(clean.join("\n")); setOk(true); setTimeout(() => setOk(false), 1500); setTimeout(() => router.refresh(), 0); }
    });
  };
  return (
    <div className="icell socials">
      {list.map((u, i) => {
        const net = netOf(u), href = hrefOf(u.trim());
        return (
          <div key={i} className="social-row">
            {net && <span className="social-net">{net}</span>}
            <input className="iedit" value={u} placeholder={t("prof.socialPh")} aria-label={`${t("prof.socials")} ${i + 1}`}
              onChange={(e) => setList(list.map((x, j) => (j === i ? e.target.value : x)))} onBlur={() => save(list)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            {href && <a className="small alink" href={href} target="_blank" rel="noreferrer" aria-label="↗">↗</a>}
            {(list.length > 1 || u) && <button type="button" className="iconbtn sm" title={t("prof.socialDel")} aria-label={t("prof.socialDel")} onClick={() => { const n = list.filter((_, j) => j !== i); setList(n.length ? n : [""]); save(n); }}>×</button>}
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        {list.every((x) => x.trim()) && list.length < 8 && <button type="button" className="social-add" onClick={() => setList([...list, ""])}>+ {t("prof.socialAdd")}</button>}
        {pending ? <span className="small text-text3">…</span> : ok ? <span className="small text-ok">✓</span> : null}
      </div>
    </div>
  );
}

export function InlineContacts({ d }: { d: InlineData }) {
  const { t } = useT();
  return (
    <section className="card sm">
      <p className="cardtitle">{t("prof.contact")}</p>
      <dl className="kv ikv">
        <dt>{t("auth.email")}</dt><dd><Cell id={d.id} k="email" init={d.email} type="email" placeholder="name@mail.ru" /></dd>
        <dt>{t("ob.phone")}</dt><dd><Cell id={d.id} k="phone" init={d.phone} type="tel" placeholder="+7 900 000-00-00" /></dd>
        <dt>Telegram</dt><dd><Cell id={d.id} k="telegram" init={d.telegram} placeholder="nick" prefix="@" /></dd>
        <dt>{t("prof.socials")}</dt><dd><Socials id={d.id} init={d.socials ?? (d.vk ? [d.vk] : [])} /></dd>
        <dt>{t("prof.tz")}</dt><dd><Choice id={d.id} k="timezone" init={d.timezone} options={TIMEZONES} /></dd>
        <dt>{t("prof.callLink")}</dt><dd><Cell id={d.id} k="callLink" init={d.callLink} placeholder="https://telemost.yandex.ru/…" link /></dd>
      </dl>
    </section>
  );
}

export function InlineAbout({ d, courses }: { d: InlineData; courses: { id: string; title: string }[] }) {
  const { t, lang } = useT();
  return (
    <section className="card sm">
      <p className="cardtitle">{t("prof.about")}</p>
      <dl className="kv ikv">
        <dt>{t("prof.course")}</dt>
        <dd>
          {courses.length ? <Choice id={d.id} k="course" init={d.courseId} options={courses.map((c) => [c.id, c.title])} /> : <span className="small muted">{d.courseText || t("prof.noCoursesYet")}</span>}
        </dd>
        <dt>{t("prof.gender")}</dt><dd><Choice id={d.id} k="gender" init={d.gender ?? ""} options={[["f", t("prof.genderF")], ["m", t("prof.genderM")]]} /></dd>
        <dt>{t("prof.level")}</dt><dd><Choice id={d.id} k="level" init={d.level} options={LEVELS.map((l) => [l, l])} own /></dd>
        <dt>{t("prof.interests")}</dt><dd><Cell id={d.id} k="interests" init={d.interests} placeholder={t("prof.interestsPh")} /></dd>
        <dt>{t("prof.birthday")}</dt><dd><Cell id={d.id} k="birthday" init={d.birthday} type="date" /></dd>
        <dt>{t("prof.examGoal")}</dt><dd><Cell id={d.id} k="examGoal" init={d.examGoal} placeholder="IELTS 7.0, ЕГЭ 90+…" /></dd>
        <dt>{t("prof.started")}</dt><dd><Cell id={d.id} k="startedAt" init={d.startedAt} type="date" /></dd>
        <dt>{t("prof.source")}</dt><dd><Choice id={d.id} k="source" init={d.source} options={SOURCES.map(([ru, en]) => [ru, lang === "en" ? en : ru])} own /></dd>
      </dl>
    </section>
  );
}
