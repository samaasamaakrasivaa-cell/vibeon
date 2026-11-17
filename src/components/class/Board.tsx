"use client";
// Доска урока: SVG-холст 1600×1000, объекты синхронизируются через класс (send("board", …)).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { useT } from "@/lib/i18n/client";
import { upload } from "../courses/CourseView";
import { randomId } from "../builder/rid";

export type BObj = {
  id: string; t: "pen" | "marker" | "line" | "arrow" | "rect" | "ellipse" | "text" | "sticky" | "image" | "curtain" | "link" | "timeline" | "table";
  pts?: number[]; x?: number; y?: number; w?: number; h?: number; x1?: number; y1?: number; x2?: number; y2?: number;
  color?: string; sw?: number; fill?: boolean; text?: string; size?: number; bg?: string; src?: string; dens?: number; by?: string;
  a?: string; b?: string; // link: связь двух объектов (интеллект-карта) — линия идёт за ними при перетаскивании
  cuts?: number[]; labels?: string[]; // timeline: границы отрезков (доли ширины) и подписи
  rows?: number; cols?: number; cells?: string[][]; // table
  head?: string; list?: boolean; // стикер-колонка с заголовком; list — Enter начинает новый пункт
};
type Edit = { id: string; r?: number; c?: number; value: string };
type Tool = "move" | "pen" | "marker" | "eraser" | "line" | "arrow" | "rect" | "ellipse" | "text" | "sticky" | "curtain";
const W = 1600, H = 1000;
const COLORS = ["#1C1C1E", "#0A84FF", "#34C759", "#FF9500", "#FF3B30", "#A55CF5"];
const MORE = ["#5AC8FA", "#FFCC00", "#FF2D55", "#8E8E93", "#795548", "#00C7BE", "#5856D6", "#FF6B9A", "#30B0C7", "#AF52DE", "#A2845E", "#FFFFFF"];
const STICKY = ["#FFF4B8", "#FFD6E0", "#D4F5DD", "#D6E8FF", "#EADCFF"];
const SIZES = [2, 4, 7, 11, 16];

const center = (o: BObj) => { const b = bbox(o); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };
/** Ячейка таблицы: прямоугольник в координатах доски. */
const cellBox = (o: BObj, r: number, c: number) => { const cw = o.w! / o.cols!, ch = o.h! / o.rows!; return { x: o.x! + c * cw, y: o.y! + r * ch, w: cw, h: ch }; };
const TL_COLORS = ["#EADCFF", "#D4F5DD", "#D6E8FF"];
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

function Shape({ o, me, role, all }: { o: BObj; me: string; role: "teacher" | "student"; all?: Map<string, BObj> }) {
  const c = o.color ?? "#1C1C1E";
  switch (o.t) {
    case "link": {
      const A = all?.get(o.a ?? ""), B = all?.get(o.b ?? "");
      if (!A || !B) return null;
      const p = center(A), q = center(B);
      return <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={c} strokeWidth={o.sw ?? 3} strokeLinecap="round" pointerEvents="none" />;
    }
    case "timeline": {
      // три отрезка (прошлое — настоящее — будущее), границы можно тянуть
      const cuts = o.cuts ?? [1 / 3, 2 / 3], xs = [o.x!, o.x! + cuts[0] * o.w!, o.x! + cuts[1] * o.w!, o.x! + o.w!];
      const labels = o.labels ?? ["Past", "Present", "Future"];
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={xs[i]} y={o.y} width={Math.max(0, xs[i + 1] - xs[i])} height={o.h} fill={TL_COLORS[i]} rx={i === 0 ? 14 : 0} />
              <text x={(xs[i] + xs[i + 1]) / 2} y={o.y! + 54} textAnchor="middle" fontSize={34} fontWeight={700} fill="#1C1C1E" fontFamily="-apple-system, system-ui, sans-serif">{labels[i]}</text>
            </g>
          ))}
          <line x1={o.x} y1={o.y! + o.h! + 40} x2={o.x! + o.w! + 30} y2={o.y! + o.h! + 40} stroke={c} strokeWidth={5} strokeLinecap="round" markerEnd={`url(#ah-${c.slice(1)})`} />
          {[1, 2].map((i) => (
            <g key={i} data-cut={i - 1} data-tl={o.id} style={{ cursor: "ew-resize" }}>
              <rect data-cut={i - 1} data-tl={o.id} x={xs[i] - 14} y={o.y! - 10} width={28} height={o.h! + 60} fill="transparent" />
              <line data-cut={i - 1} data-tl={o.id} x1={xs[i]} y1={o.y! - 6} x2={xs[i]} y2={o.y! + o.h! + 46} stroke="#1C1C1E" strokeWidth={4} strokeDasharray="10 8" />
              <circle data-cut={i - 1} data-tl={o.id} cx={xs[i]} cy={o.y! + o.h! + 40} r={13} fill="#fff" stroke="#1C1C1E" strokeWidth={4} />
            </g>
          ))}
        </g>
      );
    }
    case "table": {
      const cw = o.w! / o.cols!, ch = o.h! / o.rows!;
      return (
        <g>
          <rect x={o.x} y={o.y} width={o.w} height={ch} fill="#E5F0FF" />
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke="#8E8E93" strokeWidth={2} rx={6} />
          {Array.from({ length: o.rows! - 1 }, (_, r) => <line key={`r${r}`} x1={o.x} x2={o.x! + o.w!} y1={o.y! + (r + 1) * ch} y2={o.y! + (r + 1) * ch} stroke="#C7C7CC" strokeWidth={2} />)}
          {Array.from({ length: o.cols! - 1 }, (_, k) => <line key={`c${k}`} y1={o.y} y2={o.y! + o.h!} x1={o.x! + (k + 1) * cw} x2={o.x! + (k + 1) * cw} stroke="#C7C7CC" strokeWidth={2} />)}
          {(o.cells ?? []).map((row, r) => row.map((v, k) => v ? (
            <foreignObject key={`${r}-${k}`} x={o.x! + k * cw + 8} y={o.y! + r * ch + 6} width={cw - 16} height={ch - 12}><div className="bd-sticky" style={{ fontWeight: r === 0 ? 700 : 400 }}>{v}</div></foreignObject>
          ) : null))}
        </g>
      );
    }
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
          <foreignObject x={o.x! + 10} y={o.y! + 8} width={o.w! - 20} height={o.h! - 16}><div className="bd-sticky">{o.head && <b className="bd-head" style={{ color: o.color }}>{o.head}</b>}{o.text}</div></foreignObject>
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
  const [edit, setEdit] = useState<Edit | null>(null); // печать прямо на доске: стикер, текст, ячейка таблицы
  const [tableAsk, setTableAsk] = useState<{ rows: number; cols: number } | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const caret = useRef<number | null>(null); // куда поставить курсор после автопункта списка
  useLayoutEffect(() => { if (caret.current !== null && editRef.current) { editRef.current.selectionStart = editRef.current.selectionEnd = caret.current; caret.current = null; } }, [edit]);
  const [lasers, setLasers] = useState<Record<string, { x: number; y: number; at: number }>>({});
  const drag = useRef<{ kind: "move" | "resize" | "draw" | "cut"; sx: number; sy: number; orig?: BObj; cut?: number; moved?: boolean } | null>(null);
  const mine = useRef<string[]>([]);
  const lastLaser = useRef(0);
  const objs = useMemo(() => pages[page] ?? [], [pages, page]);
  const byId = useMemo(() => new Map(objs.map((o) => [o.id, o])), [objs]);
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
  const del = (id: string) => {
    // вместе с объектом — его связи (интеллект-карта)
    const gone = [id, ...objs.filter((o) => o.t === "link" && (o.a === id || o.b === id)).map((o) => o.id)];
    setPages((p) => p.map((x, i) => (i === page ? x.filter((y) => !gone.includes(y.id)) : x)));
    gone.forEach((g) => send("board", { op: "del", page, obj: { id: g } }));
  };
  const hit = (x: number, y: number, r = 6) => [...objs].reverse().find((o) => { if (o.t === "link") return false; const b = bbox(o); return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r; });
  /** Открыть печать: у таблицы — ячейка под курсором. */
  const openEdit = (o: BObj, at?: { x: number; y: number }) => {
    if (!canDraw) return;
    if (o.t === "table") {
      const r = at ? Math.min(o.rows! - 1, Math.max(0, Math.floor(((at.y - o.y!) / o.h!) * o.rows!))) : 0;
      const c = at ? Math.min(o.cols! - 1, Math.max(0, Math.floor(((at.x - o.x!) / o.w!) * o.cols!))) : 0;
      setEdit({ id: o.id, r, c, value: o.cells?.[r]?.[c] ?? "" });
    } else if (o.t === "sticky" || o.t === "text") setEdit({ id: o.id, value: o.text ?? "" });
  };
  const commit = (e: Edit | null = edit) => {
    if (!e) return;
    setEdit(null);
    const o = (pages[page] ?? []).find((x) => x.id === e.id);
    if (!o) return;
    if (o.t === "table") {
      const cells = Array.from({ length: o.rows! }, (_, r) => Array.from({ length: o.cols! }, (_, c) => o.cells?.[r]?.[c] ?? ""));
      cells[e.r!][e.c!] = e.value;
      upd({ ...o, cells });
    } else if (o.t === "text" && !e.value.trim()) del(o.id);
    else if (o.text !== e.value) upd({ ...o, text: e.value });
  };

  const down = (e: React.PointerEvent) => {
    const p = pt(e);
    if (laser) return;
    if (!canDraw) return;
    const tgt = e.target as Element;
    if (edit) { commit(); if (!tgt.getAttribute("data-add")) return; } // клик мимо — сохранить напечатанное
    // граница отрезка линии времени — тянется любым инструментом
    const cut = tgt.getAttribute("data-cut");
    if (cut !== null && tool !== "eraser") {
      const o = byId.get(tgt.getAttribute("data-tl") ?? "");
      if (o?.t === "timeline") { tgt.setPointerCapture?.(e.pointerId); drag.current = { kind: "cut", sx: p.x, sy: p.y, orig: o, cut: Number(cut) }; return; }
    }
    // «+» у выбранного стикера — новая ветка интеллект-карты
    if (tgt.getAttribute("data-add") && sel) {
      const o = byId.get(sel);
      if (o) {
        const kids = objs.filter((x) => x.t === "link" && x.a === o.id).length;
        const n: BObj = { id: randomId(), t: "sticky", x: Math.min(W - 220, o.x! + o.w! + 140), y: Math.max(20, Math.min(H - 140, o.y! + (kids - 1) * 150)), w: 200, h: 100, text: "", bg: STICKY[(kids + 2) % STICKY.length], by: me };
        put(n); put({ id: randomId(), t: "link", a: o.id, b: n.id, color: color === "#1C1C1E" ? "#0A84FF" : color, sw: 3, by: me });
        setSel(n.id); setEdit({ id: n.id, value: "" });
        e.preventDefault(); // иначе mousedown заберёт фокус у поля ввода
      }
      return;
    }
    tgt.setPointerCapture?.(e.pointerId);
    const sw = SIZES[size];
    if (tool === "move") {
      const o = hit(p.x, p.y);
      setSel(o?.id ?? null);
      if (o) drag.current = { kind: (e.target as Element).getAttribute("data-handle") ? "resize" : "move", sx: p.x, sy: p.y, orig: o };
      return;
    }
    if (tool === "eraser") { drag.current = { kind: "draw", sx: p.x, sy: p.y }; const o = hit(p.x, p.y, eraser / 2); if (o) del(o.id); return; }
    // текст и стикер — печать прямо на доске, без окна
    if (tool === "text" || tool === "sticky") e.preventDefault(); // поле ввода откроется сразу — фокус не отдаём
    if (tool === "text") { const o = hit(p.x, p.y); if (o?.t === "text") { openEdit(o); return; } const n: BObj = { id: randomId(), t: "text", x: p.x, y: p.y, text: "", color, size: 20 + size * 8, by: me }; put(n); setEdit({ id: n.id, value: "" }); return; }
    if (tool === "sticky") { const o = hit(p.x, p.y); if (o?.t === "sticky") { openEdit(o); return; } const n: BObj = { id: randomId(), t: "sticky", x: p.x - 100, y: p.y - 70, w: 200, h: 140, text: "", bg: stickyBg, by: me }; put(n); setEdit({ id: n.id, value: "" }); return; }
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
    if (d.kind === "cut" && d.orig) {
      const o = d.orig, cuts = [...(o.cuts ?? [1 / 3, 2 / 3])], i = d.cut!;
      const f = (p.x - o.x!) / o.w!;
      cuts[i] = Math.max(i === 0 ? 0.08 : cuts[0] + 0.08, Math.min(i === 0 ? cuts[1] - 0.08 : 0.92, f));
      upd({ ...o, cuts }, false);
      return;
    }
    if (Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) > 4) d.moved = true;
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
  const up = (e?: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && (d.kind === "move" || d.kind === "resize" || d.kind === "cut") && d.orig) {
      const cur = (pages[page] ?? []).find((o) => o.id === d.orig!.id);
      // нажали и не тянули — печать (стикер, текст, ячейка таблицы)
      if (d.kind === "move" && !d.moved && cur && e) { openEdit(cur, pt(e)); return; }
      if (cur && d.moved !== false) send("board", { op: "update", page, obj: cur });
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
    if (o) openEdit(o, { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H });
  };

  const template = (kind: "mind" | "pros" | "time" | "table", size?: { rows: number; cols: number }) => {
    setTpl(false);
    const c = color === "#1C1C1E" ? "#0A84FF" : color;
    const add = (o: Omit<BObj, "id">) => { const x = { ...o, id: randomId(), by: me } as BObj; put(x); return x; };
    if (kind === "mind") {
      // центр и ветки связаны: тянете стикер — линии идут за ним; «+» у выбранного стикера — новая ветка
      const root = add({ t: "sticky", x: 700, y: 430, w: 200, h: 110, text: "Topic", bg: "#D6E8FF" });
      [[330, 220], [1070, 220], [330, 640], [1070, 640]].forEach(([x, y], i) => {
        const n = add({ t: "sticky", x, y, w: 200, h: 100, text: "", bg: STICKY[(i + 1) % STICKY.length] });
        add({ t: "link", a: root.id, b: n.id, color: c, sw: 3 });
      });
    }
    if (kind === "pros") {
      add({ t: "sticky", x: 140, y: 120, w: 640, h: 760, head: "For", text: "• ", list: true, bg: "#E8F8EC", color: "#1E7B34" });
      add({ t: "sticky", x: 820, y: 120, w: 640, h: 760, head: "Against", text: "• ", list: true, bg: "#FDECEB", color: "#C4161C" });
    }
    if (kind === "time") add({ t: "timeline", x: 120, y: 360, w: 1340, h: 200, cuts: [1 / 3, 2 / 3], labels: ["Past", "Present", "Future"], color: c });
    if (kind === "table" && size) {
      const rows = Math.max(1, Math.min(12, size.rows)), cols = Math.max(1, Math.min(8, size.cols));
      const w = Math.min(1400, cols * 260), h = Math.min(860, rows * 90);
      add({ t: "table", x: (W - w) / 2, y: (H - h) / 2, w, h, rows, cols, cells: Array.from({ length: rows }, () => Array(cols).fill("")) });
    }
    setTool("move"); setLaser(false); // после шаблона — сразу двигать и печатать
  };
  /** Таблица: добавить/убрать строку или столбец. */
  const resizeTable = (o: BObj, dr: number, dc: number) => {
    const rows = Math.max(1, Math.min(12, o.rows! + dr)), cols = Math.max(1, Math.min(8, o.cols! + dc));
    const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => o.cells?.[r]?.[c] ?? ""));
    upd({ ...o, rows, cols, cells, w: Math.min(W - o.x!, o.w! * cols / o.cols!), h: Math.min(H - o.y!, o.h! * rows / o.rows!) });
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
          <button className="btn plain sm" data-tip={t("bd.templatesTip")} onClick={() => setTpl(!tpl)} disabled={!canDraw}><Icon name="levelI" size="sm" />{t("bd.templates")}</button>
          {tpl && (
            <div className="bd-pop">
              <button onClick={() => template("mind")}>{t("bd.mind")}</button><button onClick={() => template("pros")}>{t("bd.prosCons")}</button>
              <button onClick={() => template("time")}>{t("bd.timeline")}</button><button onClick={() => { setTpl(false); setTableAsk({ rows: 3, cols: 3 }); }}>{t("bd.table")}</button>
            </div>
          )}
        </div>
        <span className="bd-sep" />
        {COLORS.map((c) => <button key={c} className={`bd-col ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
        <div className="relative">
          <button className="bd-col more" onClick={() => setMore(!more)} aria-label={t("bd.moreColors")} data-tip={t("bd.moreColors")} />
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
        <button className="iconbtn" data-tip={t("bd.undo")} aria-label={t("bd.undo")} disabled={!canDraw} onClick={() => { const id = mine.current.pop(); if (id) del(id); }}>↶</button>
        <button className="iconbtn" data-tip={t("bd.clear")} aria-label={t("bd.clear")} disabled={role !== "teacher"} onClick={() => { if (confirm(t("bd.clearQ"))) { setPages((p) => p.map((x, i) => (i === page ? [] : x))); send("board", { op: "clear", page }); } }}>🗑</button>
        <span className="bd-sep" />
        <button className={`iconbtn ${laser ? "bd-on" : ""}`} data-tip={t("bd.laser")} aria-label={t("bd.laser")} aria-pressed={laser} onClick={() => setLaser(!laser)}>✦</button>
        {role === "teacher" && <button className={`iconbtn ${follow ? "bd-on" : ""}`} data-tip={t("bd.follow")} aria-label={t("bd.follow")} aria-pressed={follow} onClick={() => onLive({ follow: !follow, page })}><Icon name="users" size="sm" /></button>}
        {role === "teacher" && <button className={`iconbtn ${locked ? "bd-on" : ""}`} data-tip={t("bd.lock")} aria-label={t("bd.lock")} aria-pressed={locked} onClick={() => onLive({ lockBoard: !locked })}><Icon name="lock" size="sm" /></button>}
        <label className={`iconbtn ${canDraw ? "" : "opacity-40"}`} data-tip={t("bd.upload")} aria-label={t("bd.upload")} style={{ cursor: "pointer" }}>
          <Icon name="clip" size="sm" />
          <input type="file" accept="image/*" hidden disabled={!canDraw} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = await upload(f); put({ id: randomId(), t: "image", x: 400, y: 200, w: 800, h: 600, src: r.url, by: me }); }} />
        </label>
      </div>
      {tableAsk && (
        <div className="bd-ask">
          <b>{t("bd.table")}</b>
          <label>{t("bd.rows")} <input type="number" min={1} max={12} value={tableAsk.rows} onChange={(e) => setTableAsk({ ...tableAsk, rows: Number(e.target.value) || 1 })} /></label>
          <label>{t("bd.cols")} <input type="number" min={1} max={8} value={tableAsk.cols} onChange={(e) => setTableAsk({ ...tableAsk, cols: Number(e.target.value) || 1 })} /></label>
          <button type="button" className="btn primary sm" onClick={() => { template("table", tableAsk); setTableAsk(null); }}>{t("bd.insert")}</button>
          <button type="button" className="btn plain sm" onClick={() => setTableAsk(null)}>{t("common.cancel")}</button>
        </div>
      )}
      <div className="bd-body">
        <div className="bd-tools">
          {tools.map(([k, ic, label]) => (
            <button key={k} className={tool === k && !laser ? "on" : ""} data-tip={label} aria-label={label} disabled={!canDraw} onClick={() => { setTool(k); setLaser(false); setSel(null); }}>
              {ic ? <Icon name={ic} size="sm" /> : <b>{glyph[k]}</b>}
            </button>
          ))}
        </div>
        <div className="bd-canvas">
          {!canDraw && <div className="bd-locked"><Icon name="lock" size="sm" />{t("bd.locked")}</div>}
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => up()} onDoubleClick={dbl}
            style={{ cursor: laser ? "none" : tool === "move" ? "default" : "crosshair", touchAction: "none" }}>
            <defs>
              <pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#C7C7CC" /></pattern>
              {[...COLORS, ...MORE].map((c) => <marker key={c} id={`ah-${c.slice(1)}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill={c} /></marker>)}
            </defs>
            <rect width={W} height={H} fill="url(#dots)" />
            {/* связи интеллект-карты — под стикерами */}
            {[...objs.filter((o) => o.t === "link"), ...objs.filter((o) => o.t !== "link")].map((o) => <Shape key={o.id} o={o} me={me} role={role} all={byId} />)}
            {draft && <Shape o={draft} me={me} role={role} />}
            {sb && tool === "move" && (
              <g>
                <rect x={sb.x - 6} y={sb.y - 6} width={sb.w + 12} height={sb.h + 12} fill="none" stroke="#0A84FF" strokeDasharray="6 4" strokeWidth={2} pointerEvents="none" />
                <rect data-handle="1" x={sb.x + sb.w} y={sb.y + sb.h} width={18} height={18} rx={4} fill="#0A84FF" style={{ cursor: "nwse-resize" }} />
                {selObj?.t === "sticky" && !selObj.list && (
                  <g data-add="1" style={{ cursor: "pointer" }}>
                    <circle data-add="1" cx={sb.x + sb.w + 26} cy={sb.y + sb.h / 2} r={16} fill="#0A84FF" />
                    <text data-add="1" x={sb.x + sb.w + 26} y={sb.y + sb.h / 2 + 8} textAnchor="middle" fontSize={26} fontWeight={700} fill="#fff">+</text>
                  </g>
                )}
              </g>
            )}
            {Object.entries(lasers).map(([k, l]) => <circle key={k} cx={l.x} cy={l.y} r={12} fill="#FF3B30" opacity={0.85} style={{ filter: "drop-shadow(0 0 8px #FF3B30)" }} />)}
          </svg>
          {edit && (() => {
            const o = byId.get(edit.id);
            if (!o) return null;
            const b = o.t === "table" ? cellBox(o, edit.r!, edit.c!) : o.t === "text" ? { x: o.x!, y: o.y! - (o.size ?? 32), w: Math.max(360, bbox(o).w + 40), h: (o.size ?? 32) * 1.5 } : { x: o.x! + 6, y: o.y! + (o.head ? 50 : 4), w: o.w! - 12, h: o.h! - (o.head ? 56 : 8) };
            const scale = (svg.current?.getBoundingClientRect().width ?? W) / W;
            const fs = (o.t === "text" ? o.size ?? 32 : 22) * scale;
            const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Escape") { e.preventDefault(); commit(); return; }
              if (e.key === "Enter" && (o.t === "text" || o.t === "table") && !e.shiftKey) { e.preventDefault(); commit(); return; }
              if (e.key === "Enter" && o.list && !e.shiftKey) {
                // список «за / против»: Enter — новый пункт (точка или следующий номер)
                e.preventDefault();
                const el = e.currentTarget, pos = el.selectionStart, before = edit.value.slice(0, pos);
                const last = before.split("\n").pop() ?? "";
                const m = /^(\d+)[.)]\s/.exec(last);
                const bullet = m ? `${Number(m[1]) + 1}. ` : /^[•\-–]\s/.test(last) || !last ? "• " : "";
                const v = `${before}\n${bullet}${edit.value.slice(el.selectionEnd)}`;
                caret.current = pos + 1 + bullet.length;
                setEdit({ ...edit, value: v });
              }
            };
            return (
              <textarea ref={editRef} className="bd-edit" autoFocus value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} onBlur={() => commit()} onKeyDown={onKey}
                aria-label={t("bd.edit")}
                style={{ left: `${(b.x / W) * 100}%`, top: `${(b.y / H) * 100}%`, width: `${(b.w / W) * 100}%`, height: `${(b.h / H) * 100}%`, fontSize: fs, color: o.t === "text" ? o.color : "#1C1C1E" }} />
            );
          })()}
          {selObj?.t === "table" && sb && tool === "move" && !edit && (
            <div className="bd-tbar" style={{ left: `${(sb.x / W) * 100}%`, top: `calc(${(sb.y / H) * 100}% - 44px)` }}>
              <button type="button" onClick={() => resizeTable(selObj, 1, 0)}>+ {t("bd.row")}</button>
              <button type="button" disabled={selObj.rows! <= 1} onClick={() => resizeTable(selObj, -1, 0)}>− {t("bd.row")}</button>
              <button type="button" onClick={() => resizeTable(selObj, 0, 1)}>+ {t("bd.colShort")}</button>
              <button type="button" disabled={selObj.cols! <= 1} onClick={() => resizeTable(selObj, 0, -1)}>− {t("bd.colShort")}</button>
            </div>
          )}
          <div className="bd-pages">
            {pages.map((_, i) => <button key={i} className={i === page ? "on" : ""} onClick={() => { setPage(i); if (role === "teacher" && follow) onLive({ page: i }); }}>{i + 1}</button>)}
            {role === "teacher" && <button onClick={() => { setPages((p) => [...p, []]); send("board", { op: "newpage", page: pages.length }); setPage(pages.length); if (follow) onLive({ page: pages.length }); }} aria-label={t("bd.newPage")}>+</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
