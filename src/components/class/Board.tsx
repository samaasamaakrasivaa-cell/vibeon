"use client";
// Доска урока: SVG-холст 1600×1000, объекты синхронизируются через класс (send("board", …)).
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { upload } from "../courses/CourseView";
import { randomId } from "../builder/rid";

export type BObj = {
  id: string; t: "pen" | "marker" | "line" | "arrow" | "rect" | "ellipse" | "text" | "sticky" | "image" | "curtain";
  pts?: number[]; x?: number; y?: number; w?: number; h?: number; x1?: number; y1?: number; x2?: number; y2?: number;
  color?: string; sw?: number; fill?: boolean; text?: string; size?: number; bg?: string; src?: string; dens?: number; by?: string;
};
type Tool = "move" | "pen" | "marker" | "eraser" | "line" | "arrow" | "rect" | "ellipse" | "text" | "sticky" | "curtain";
const W = 1600, H = 1000;
const COLORS = ["#1C1C1E", "#0A84FF", "#34C759", "#FF9500", "#FF3B30", "#A55CF5"];
const MORE = ["#5AC8FA", "#FFCC00", "#FF2D55", "#8E8E93", "#795548", "#00C7BE", "#5856D6", "#FF6B9A", "#30B0C7", "#AF52DE", "#A2845E", "#FFFFFF"];
const STICKY = ["#FFF4B8", "#FFD6E0", "#D4F5DD", "#D6E8FF", "#EADCFF"];
const SIZES = [2, 4, 7, 11, 16];

const bbox = (o: BObj) => {
  if (o.pts) { const xs = o.pts.filter((_, i) => i % 2 === 0), ys = o.pts.filter((_, i) => i % 2 === 1); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (o.x1 !== undefined) return { x: Math.min(o.x1, o.x2!), y: Math.min(o.y1!, o.y2!), w: Math.abs(o.x2! - o.x1), h: Math.abs(o.y2! - o.y1!) };
  if (o.t === "text") return { x: o.x!, y: o.y! - (o.size ?? 32), w: Math.max(40, (o.text?.length ?? 1) * (o.size ?? 32) * 0.55), h: (o.size ?? 32) * 1.25 };
  return { x: o.x!, y: o.y!, w: o.w!, h: o.h! };
};
const moved = (o: BObj, dx: number, dy: number): BObj => {
  if (o.pts) return { ...o, pts: o.pts.map((v, i) => v + (i % 2 ? dy : dx)) };
  if (o.x1 !== undefined) return { ...o, x1: o.x1 + dx, y1: o.y1! + dy, x2: o.x2! + dx, y2: o.y2! + dy };
  return { ...o, x: o.x! + dx, y: o.y! + dy };
};

function Shape({ o, me, role }: { o: BObj; me: string; role: "teacher" | "student" }) {
  const c = o.color ?? "#1C1C1E";
  switch (o.t) {
    case "pen":
    case "marker": {
      const d = o.pts!.reduce((a, v, i) => a + (i % 2 === 0 ? `${i ? " L" : "M"}${v}` : ` ${v}`), "");
      return <path d={d} fill="none" stroke={c} strokeWidth={o.sw} strokeLinecap="round" strokeLinejoin="round" opacity={o.t === "marker" ? 0.35 : 1} />;
    }
    case "line":
    case "arrow":
      return <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} stroke={c} strokeWidth={o.sw} strokeLinecap="round" markerEnd={o.t === "arrow" ? `url(#ah-${c.slice(1)})` : undefined} />;
    case "rect":
      return <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={8} fill={o.fill ? c : "none"} fillOpacity={o.fill ? 0.18 : 0} stroke={c} strokeWidth={o.sw} />;
    case "ellipse":
      return <ellipse cx={o.x! + o.w! / 2} cy={o.y! + o.h! / 2} rx={o.w! / 2} ry={o.h! / 2} fill={o.fill ? c : "none"} fillOpacity={o.fill ? 0.18 : 0} stroke={c} strokeWidth={o.sw} />;
    case "text":
      return <text x={o.x} y={o.y} fill={c} fontSize={o.size ?? 32} fontFamily="-apple-system, system-ui, sans-serif">{o.text}</text>;
    case "sticky":
      return (
        <g>
          <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={10} fill={o.bg ?? STICKY[0]} stroke="rgba(0,0,0,.08)" />
          <foreignObject x={o.x! + 10} y={o.y! + 8} width={o.w! - 20} height={o.h! - 16}><div className="bd-sticky">{o.text}</div></foreignObject>
        </g>
      );
    case "image":
      return <image href={o.src} x={o.x} y={o.y} width={o.w} height={o.h} preserveAspectRatio="xMidYMid meet" />;
    case "curtain": {
      // у ученика шторка непрозрачная, у учителя — с выбранной плотностью и знаком «?»
      const op = role === "teacher" ? (o.dens ?? 0.6) : 1;
      return (
        <g>
          <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={10} fill={o.color ?? "#8E8E93"} opacity={op} />
          <text x={o.x! + o.w! / 2} y={o.y! + o.h! / 2 + 18} textAnchor="middle" fontSize={52} fontWeight={700} fill="#fff">?</text>
        </g>
      );
    }
  }
  void me;
  return null;
}

export function Board({ pages, setPages, page, setPage, role, me, locked, follow, send, onLive }: {
  pages: BObj[][]; setPages: (fn: (p: BObj[][]) => BObj[][]) => void; page: number; setPage: (n: number) => void;
  role: "teacher" | "student"; me: string; locked: boolean; follow: boolean;
  send: (type: string, data: Record<string, unknown>) => void; onLive: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useT();
  const svg = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(1);
  const [eraser, setEraser] = useState(30);
  const [fill, setFill] = useState(false);
  const [stickyBg, setStickyBg] = useState(STICKY[0]);
  const [dens, setDens] = useState(0.6);
  const [more, setMore] = useState(false);
  const [tpl, setTpl] = useState(false);
  const [draft, setDraft] = useState<BObj | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [laser, setLaser] = useState(false);
  const [lasers, setLasers] = useState<Record<string, { x: number; y: number; at: number }>>({});
  const drag = useRef<{ kind: "move" | "resize" | "draw"; sx: number; sy: number; orig?: BObj } | null>(null);
  const mine = useRef<string[]>([]);
  const lastLaser = useRef(0);
  const objs = useMemo(() => pages[page] ?? [], [pages, page]);
  const canDraw = role === "teacher" || !locked;

  // лазер других участников приходит через window-событие из класса
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; setLasers((l) => ({ ...l, [d.by]: { x: d.x, y: d.y, at: Date.now() } })); };
    window.addEventListener("vibeon-laser", h);
    const id = setInterval(() => setLasers((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => Date.now() - v.at < 1500))), 500);
    return () => { window.removeEventListener("vibeon-laser", h); clearInterval(id); };
  }, []);

  const pt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const put = (o: BObj) => { setPages((p) => { const n = p.map((x) => [...x]); while (n.length <= page) n.push([]); n[page].push(o); return n; }); mine.current.push(o.id); send("board", { op: "add", page, obj: o }); };
  const upd = (o: BObj, broadcast = true) => { setPages((p) => p.map((x, i) => (i === page ? x.map((y) => (y.id === o.id ? o : y)) : x))); if (broadcast) send("board", { op: "update", page, obj: o }); };
  const del = (id: string) => { setPages((p) => p.map((x, i) => (i === page ? x.filter((y) => y.id !== id) : x))); send("board", { op: "del", page, obj: { id } }); };
  const hit = (x: number, y: number, r = 6) => [...objs].reverse().find((o) => { const b = bbox(o); return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r; });

  const down = (e: React.PointerEvent) => {
    const p = pt(e);
    if (laser) return;
    if (!canDraw) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const sw = SIZES[size];
    if (tool === "move") {
      const o = hit(p.x, p.y);
      setSel(o?.id ?? null);
      if (o) drag.current = { kind: (e.target as Element).getAttribute("data-handle") ? "resize" : "move", sx: p.x, sy: p.y, orig: o };
      return;
    }
    if (tool === "eraser") { drag.current = { kind: "draw", sx: p.x, sy: p.y }; const o = hit(p.x, p.y, eraser / 2); if (o) del(o.id); return; }
    if (tool === "text") { const text = window.prompt(t("bd.typeText")); if (text) put({ id: randomId(), t: "text", x: p.x, y: p.y, text, color, size: 20 + size * 8, by: me }); return; }
    if (tool === "sticky") { const text = window.prompt(t("bd.typeSticky")) ?? ""; put({ id: randomId(), t: "sticky", x: p.x - 100, y: p.y - 70, w: 200, h: 140, text, bg: stickyBg, by: me }); return; }
    const id = randomId();
    drag.current = { kind: "draw", sx: p.x, sy: p.y };
    if (tool === "pen" || tool === "marker") setDraft({ id, t: tool, pts: [p.x, p.y], color, sw: tool === "marker" ? sw * 3 : sw, by: me });
    else if (tool === "line" || tool === "arrow") setDraft({ id, t: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, sw, by: me });
    else setDraft({ id, t: tool, x: p.x, y: p.y, w: 1, h: 1, color, sw, fill, dens, by: me });
  };
  const move = (e: React.PointerEvent) => {
    const p = pt(e);
    if (laser) {
      if (Date.now() - lastLaser.current > 60) { lastLaser.current = Date.now(); send("board", { op: "laser", page, obj: { id: "laser", x: p.x, y: p.y } }); }
      setLasers((l) => ({ ...l, [me]: { x: p.x, y: p.y, at: Date.now() } }));
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (tool === "eraser") { const o = hit(p.x, p.y, eraser / 2); if (o) del(o.id); return; }
    if (d.kind === "move" && d.orig) { upd(moved(d.orig, p.x - d.sx, p.y - d.sy), false); return; }
    if (d.kind === "resize" && d.orig) {
      const b = bbox(d.orig);
      const k = Math.max(0.1, (b.w + p.x - d.sx) / Math.max(1, b.w));
      const o = d.orig;
      const r: BObj = o.pts ? { ...o, pts: o.pts.map((v, i) => (i % 2 ? b.y + (v - b.y) * k : b.x + (v - b.x) * k)) }
        : o.x1 !== undefined ? { ...o, x2: o.x1 + (o.x2! - o.x1) * k, y2: o.y1! + (o.y2! - o.y1!) * k }
        : o.t === "text" ? { ...o, size: Math.max(10, (o.size ?? 32) * k) }
        : { ...o, w: Math.max(20, o.w! + p.x - d.sx), h: Math.max(20, o.h! + p.y - d.sy) };
      upd(r, false);
      return;
    }
    setDraft((dr) => {
      if (!dr) return dr;
      if (dr.pts) return { ...dr, pts: [...dr.pts, p.x, p.y] };
      if (dr.x1 !== undefined) return { ...dr, x2: p.x, y2: p.y };
      return { ...dr, x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) };
    });
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d && (d.kind === "move" || d.kind === "resize") && d.orig) {
      const cur = (pages[page] ?? []).find((o) => o.id === d.orig!.id);
      if (cur) send("board", { op: "update", page, obj: cur });
      return;
    }
    if (draft) {
      const tiny = draft.w !== undefined && draft.t !== "text" && (draft.w < 4 || draft.h! < 4);
      if (!tiny) put(draft);
      setDraft(null);
    }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.key === "Delete" || e.key === "Backspace") && sel && !(e.target as HTMLElement).closest("input,textarea")) { del(sel); setSel(null); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const dbl = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const o = hit(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
    if (o && (o.t === "text" || o.t === "sticky") && canDraw) { const text = window.prompt(t("bd.edit"), o.text ?? ""); if (text !== null) upd({ ...o, text }); }
  };

  const template = (kind: "mind" | "pros" | "time" | "table") => {
    setTpl(false);
    const c = color === "#1C1C1E" ? "#0A84FF" : color;
    const add = (o: Omit<BObj, "id">) => put({ ...o, id: randomId(), by: me } as BObj);
    if (kind === "mind") {
      add({ t: "sticky", x: 700, y: 430, w: 200, h: 110, text: t("bd.topic"), bg: "#D6E8FF" });
      [[330, 220], [1070, 220], [330, 640], [1070, 640]].forEach(([x, y]) => {
        add({ t: "line", x1: 800, y1: 485, x2: x + 100, y2: y + 50, color: c, sw: 3 });
        add({ t: "sticky", x, y, w: 200, h: 100, text: t("bd.branch"), bg: "#FFFFFF" });
      });
    }
    if (kind === "pros") {
      add({ t: "rect", x: 160, y: 140, w: 600, h: 720, color: "#34C759", sw: 3, fill: true });
      add({ t: "rect", x: 840, y: 140, w: 600, h: 720, color: "#FF3B30", sw: 3, fill: true });
      add({ t: "text", x: 400, y: 200, text: t("bd.pros"), color: "#1E7B34", size: 40 });
      add({ t: "text", x: 1080, y: 200, text: t("bd.cons"), color: "#C4161C", size: 40 });
    }
    if (kind === "time") {
      add({ t: "arrow", x1: 120, y1: 500, x2: 1480, y2: 500, color: c, sw: 5 });
      [300, 620, 940, 1260].forEach((x, i) => { add({ t: "ellipse", x: x - 14, y: 486, w: 28, h: 28, color: c, sw: 4, fill: true }); add({ t: "text", x: x - 40, y: 570, text: `${2020 + i * 2}`, color: "#1C1C1E", size: 28 }); });
    }
    if (kind === "table") for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) add({ t: "sticky", x: 380 + col * 290, y: 220 + r * 190, w: 280, h: 180, text: r === 0 ? `${t("bd.col")} ${col + 1}` : "", bg: r === 0 ? "#E5F0FF" : "#FFFFFF" });
  };

  const selObj = objs.find((o) => o.id === sel);
  const sb = selObj ? bbox(selObj) : null;
  const tools: [Tool, Parameters<typeof Icon>[0]["name"] | null, string][] = [
    ["move", "move", t("bd.move")], ["pen", "pencil", t("bd.pen")], ["marker", "pencilI", t("bd.marker")], ["eraser", "close", t("bd.eraser")],
    ["line", null, t("bd.line")], ["arrow", "right", t("bd.arrow")], ["rect", null, t("bd.rect")], ["ellipse", null, t("bd.ellipse")],
    ["text", null, t("bd.text")], ["sticky", "note", t("bd.sticky")], ["curtain", "lockI", t("bd.curtain")],
  ];
  const glyph: Partial<Record<Tool, string>> = { line: "╱", rect: "▭", ellipse: "◯", text: "T" };

  return (
    <div className="bd">
      <div className="bd-top">
        <div className="relative">
          <button className="btn plain sm" onClick={() => setTpl(!tpl)} disabled={!canDraw}><Icon name="levelI" size="sm" />{t("bd.templates")}</button>
          {tpl && (
            <div className="bd-pop">
              <button onClick={() => template("mind")}>{t("bd.mind")}</button><button onClick={() => template("pros")}>{t("bd.prosCons")}</button>
              <button onClick={() => template("time")}>{t("bd.timeline")}</button><button onClick={() => template("table")}>{t("bd.table")}</button>
            </div>
          )}
        </div>
        <span className="bd-sep" />
        {COLORS.map((c) => <button key={c} className={`bd-col ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
        <div className="relative">
          <button className="bd-col more" onClick={() => setMore(!more)} aria-label={t("bd.moreColors")} title={t("bd.moreColors")} />
          {more && (
            <div className="bd-pop grid grid-cols-6 gap-1.5 p-2">
              {MORE.map((c) => <button key={c} className={`bd-col ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => { setColor(c); setMore(false); }} aria-label={c} />)}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="col-span-6 h-8 w-full" aria-label={t("bd.palette")} />
            </div>
          )}
        </div>
        <span className="bd-sep" />
        {tool === "eraser" ? (
          <label className="small flex items-center gap-2 text-text2">{t("bd.eraserSize")}<input type="range" min={10} max={120} value={eraser} onChange={(e) => setEraser(+e.target.value)} /></label>
        ) : tool === "sticky" ? (
          <>{STICKY.map((c) => <button key={c} className={`bd-col ${stickyBg === c ? "on" : ""}`} style={{ background: c }} onClick={() => setStickyBg(c)} aria-label={c} />)}</>
        ) : tool === "curtain" ? (
          <label className="small flex items-center gap-2 text-text2">{t("bd.density")}<input type="range" min={0.2} max={0.95} step={0.05} value={dens} onChange={(e) => setDens(+e.target.value)} /></label>
        ) : (
          <>
            <span className="small text-text3">{t("bd.thickness")}</span>
            {SIZES.map((s, i) => <button key={s} className={`bd-size ${size === i ? "on" : ""}`} onClick={() => setSize(i)} aria-label={`${s}`}><i style={{ width: 4 + i * 3, height: 4 + i * 3 }} /></button>)}
            {(tool === "rect" || tool === "ellipse") && <label className="small ml-1 flex items-center gap-1"><input type="checkbox" className="check" checked={fill} onChange={(e) => setFill(e.target.checked)} />{t("bd.fill")}</label>}
          </>
        )}
        <span className="grow" />
        <button className="iconbtn" title={t("bd.undo")} aria-label={t("bd.undo")} disabled={!canDraw} onClick={() => { const id = mine.current.pop(); if (id) del(id); }}>↶</button>
        <button className="iconbtn" title={t("bd.clear")} aria-label={t("bd.clear")} disabled={role !== "teacher"} onClick={() => { if (confirm(t("bd.clearQ"))) { setPages((p) => p.map((x, i) => (i === page ? [] : x))); send("board", { op: "clear", page }); } }}>🗑</button>
        <span className="bd-sep" />
        <button className={`iconbtn ${laser ? "bd-on" : ""}`} title={t("bd.laser")} aria-label={t("bd.laser")} aria-pressed={laser} onClick={() => setLaser(!laser)}>✦</button>
        {role === "teacher" && <button className={`iconbtn ${follow ? "bd-on" : ""}`} title={t("bd.follow")} aria-label={t("bd.follow")} aria-pressed={follow} onClick={() => onLive({ follow: !follow, page })}><Icon name="users" size="sm" /></button>}
        {role === "teacher" && <button className={`iconbtn ${locked ? "bd-on" : ""}`} title={t("bd.lock")} aria-label={t("bd.lock")} aria-pressed={locked} onClick={() => onLive({ lockBoard: !locked })}><Icon name="lock" size="sm" /></button>}
        <label className={`iconbtn ${canDraw ? "" : "opacity-40"}`} title={t("bd.upload")} aria-label={t("bd.upload")} style={{ cursor: "pointer" }}>
          <Icon name="clip" size="sm" />
          <input type="file" accept="image/*" hidden disabled={!canDraw} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = await upload(f); put({ id: randomId(), t: "image", x: 400, y: 200, w: 800, h: 600, src: r.url, by: me }); }} />
        </label>
      </div>
      <div className="bd-body">
        <div className="bd-tools">
          {tools.map(([k, ic, label]) => (
            <button key={k} className={tool === k && !laser ? "on" : ""} title={label} aria-label={label} disabled={!canDraw} onClick={() => { setTool(k); setLaser(false); setSel(null); }}>
              {ic ? <Icon name={ic} size="sm" /> : <b>{glyph[k]}</b>}
            </button>
          ))}
        </div>
        <div className="bd-canvas">
          {!canDraw && <div className="bd-locked"><Icon name="lock" size="sm" />{t("bd.locked")}</div>}
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onDoubleClick={dbl}
            style={{ cursor: laser ? "none" : tool === "move" ? "default" : "crosshair", touchAction: "none" }}>
            <defs>
              <pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#C7C7CC" /></pattern>
              {[...COLORS, ...MORE].map((c) => <marker key={c} id={`ah-${c.slice(1)}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill={c} /></marker>)}
            </defs>
            <rect width={W} height={H} fill="url(#dots)" />
            {objs.map((o) => <Shape key={o.id} o={o} me={me} role={role} />)}
            {draft && <Shape o={draft} me={me} role={role} />}
            {sb && tool === "move" && (
              <g>
                <rect x={sb.x - 6} y={sb.y - 6} width={sb.w + 12} height={sb.h + 12} fill="none" stroke="#0A84FF" strokeDasharray="6 4" strokeWidth={2} pointerEvents="none" />
                <rect data-handle="1" x={sb.x + sb.w} y={sb.y + sb.h} width={18} height={18} rx={4} fill="#0A84FF" style={{ cursor: "nwse-resize" }} />
              </g>
            )}
            {Object.entries(lasers).map(([k, l]) => <circle key={k} cx={l.x} cy={l.y} r={12} fill="#FF3B30" opacity={0.85} style={{ filter: "drop-shadow(0 0 8px #FF3B30)" }} />)}
          </svg>
          <div className="bd-pages">
            {pages.map((_, i) => <button key={i} className={i === page ? "on" : ""} onClick={() => { setPage(i); if (role === "teacher" && follow) onLive({ page: i }); }}>{i + 1}</button>)}
            {role === "teacher" && <button onClick={() => { setPages((p) => [...p, []]); send("board", { op: "newpage", page: pages.length }); setPage(pages.length); if (follow) onLive({ page: pages.length }); }} aria-label={t("bd.newPage")}>+</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
