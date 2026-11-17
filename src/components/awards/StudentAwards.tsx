"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { keepMyAvatar, markAwardSeen, setMyAvatar } from "@/lib/awards/actions";
import { METALS, type Metal } from "@/lib/awards/catalog";
import { Dialog } from "../Dialog";
import { Icon } from "../Icon";
import { CHARACTER_KEYS, CHARACTERS, CharacterArt } from "./Characters";
import { Medal, StudentAvatar } from "./Medal";

export type NewAward = { id: string; kind: string; name: string; why: string | null; icon: string; color: string; until: string | null };

/** Праздничное окно: новый титул или поощрение — по одному, пока ученик их не увидел. */
export function CelebrateAwards({ items: init, inClass = false }: { items: NewAward[]; inClass?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [items] = useState(init); // снимок: после отметки «просмотрено» список с сервера сокращается — индекс не должен съезжать
  const [i, setI] = useState(0);
  const [, start] = useTransition();
  const a = items[i];
  if (!a) return null;
  const next = () => { const id = a.id; start(async () => { await markAwardSeen(id); if (i + 1 >= items.length && !inClass) router.refresh(); }); setI(i + 1); };
  const m = METALS[(a.color as Metal) in METALS ? (a.color as Metal) : "gold"];
  return (
    <Dialog open onClose={next}>
      <div className="awcele">
        <span className="awconf" aria-hidden="true">{Array.from({ length: 14 }, (_, k) => <i key={k} style={{ left: `${(k * 71) % 100}%`, animationDelay: `${(k % 7) * 0.12}s`, background: ["#FFC93C", "#A55CF5", "#3D8BFF", "#FF6B9A", "#34C759"][k % 5] }} />)}</span>
        <span className="awcele-k">{a.kind === "title" ? t("aw.newTitle") : inClass ? t("chr.fromTeacher") : t("aw.newCheer")}</span>
        <Medal icon={a.icon} color={a.color} size={120} shape={a.kind === "title" ? "hex" : "circle"} />
        <h2 style={{ color: m.text }}>{a.name}</h2>
        {a.why && <p className="awcele-why">{a.why}</p>}
        {a.until && <span className="small muted">{t("aw.until", { d: a.until })}</span>}
        <div className="flex w-full gap-2">
          {!inClass && <Link href="/student/progress#awards" className="btn secondary grow" onClick={next}>{t("aw.allMine")}</Link>}
          <button type="button" className="btn primary grow" onClick={next}>{t("aw.hooray")}</button>
        </div>
      </div>
    </Dialog>
  );
}

/** Фото взято из Telegram — спросить: оставить или заменить. */
export function AvatarNotice({ id, avatar }: { id: string; avatar: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const [hide, setHide] = useState(false);
  const [, start] = useTransition();
  if (hide) return null;
  return (
    <div className="avnotice">
      <StudentAvatar id={id} avatar={avatar} size={44} />
      <span className="grow">{t("av.fromTg")}</span>
      <button type="button" className="btn secondary sm" onClick={() => { setHide(true); start(async () => { await keepMyAvatar(); router.refresh(); }); }}>{t("av.keep")}</button>
      <Link href="/student/profile#avatar" className="btn primary sm">{t("av.change")}</Link>
    </div>
  );
}

/** Профиль → «Аватарка»: персонажи, своё фото, фото из Telegram. */
export function AvatarPicker({ id, avatar, tgLinked }: { id: string; avatar: string | null; tgLinked: boolean }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [tab, setTab] = useState<"char" | "photo" | "tg">(avatar && !avatar.startsWith("char:") ? "photo" : "char");
  const [v, setV] = useState(avatar);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const save = (val: string) => start(async () => {
    setErr(null); setOk(false);
    const r = await setMyAvatar(val);
    if (!r.ok) return setErr(r.error === "tg" ? t("av.noTg") : t("av.err"));
    setOk(true); router.refresh();
  });
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/upload", { method: "POST", body: fd }).then((x) => x.json()).catch(() => null);
    if (!r?.url) return setErr(t("av.err"));
    setV(r.url); save(r.url);
  };
  return (
    <section className="card" id="avatar">
      <div className="avpick">
        <div className="avpick-prev">
          <StudentAvatar id={id} avatar={v} size={112} />
          <span className="small muted">{t("av.hint")}</span>
        </div>
        <div className="grow min-w-0 flex flex-col gap-3">
          <h2 className="m-0">{t("av.title")}</h2>
          <div className="seg w-full">
            <button type="button" className="flex-1" aria-pressed={tab === "char"} onClick={() => setTab("char")}>{t("av.chars")}</button>
            <button type="button" className="flex-1" aria-pressed={tab === "photo"} onClick={() => setTab("photo")}>{t("av.photo")}</button>
            <button type="button" className="flex-1" aria-pressed={tab === "tg"} onClick={() => setTab("tg")}>Telegram</button>
          </div>
          {tab === "char" && (
            <div className="avchars">
              {CHARACTER_KEYS.map((k) => (
                <button key={k} type="button" className={`avchar ${v === `char:${k}` ? "on" : ""}`} aria-pressed={v === `char:${k}`} onClick={() => { setV(`char:${k}`); save(`char:${k}`); }} disabled={pending}>
                  <span className="avchar-img"><CharacterArt k={k} size={64} /></span>
                  <span className="small">{CHARACTERS[k][lang === "en" ? "en" : "ru"]}</span>
                </button>
              ))}
            </div>
          )}
          {tab === "photo" && (
            <div className="flex flex-wrap items-center gap-3">
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
              <button type="button" className="btn primary" disabled={pending} onClick={() => file.current?.click()}><Icon name="image" size="sm" />{t("av.upload")}</button>
              <span className="small muted">{t("av.uploadHint")}</span>
            </div>
          )}
          {tab === "tg" && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn primary" disabled={pending || !tgLinked} onClick={() => save("tg")}><Icon name="send" size="sm" />{t("av.takeTg")}</button>
              <span className="small muted">{tgLinked ? t("av.tgHint") : t("av.tgNotLinked")}</span>
            </div>
          )}
          {err && <div className="alert">{err}</div>}
          {ok && <span className="small text-ok">✓ {t("common.saved")}</span>}
        </div>
      </div>
    </section>
  );
}
