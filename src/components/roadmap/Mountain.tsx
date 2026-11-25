"use client";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";

type MPoint = { id: string; title: string; hours: number; level?: string; ok?: Record<string, unknown> };
type MStage = { lvl: string; title: string; hours: number; passed?: unknown; points?: MPoint[]; kind?: string | null };

// Сцена 720×400: дорога всегда идёт серпантином ВВЕРХ по склону горы и заканчивается на вершине —
// при любом числе участков. Флажки участков и мини-точки ставятся по часам вдоль дороги.
const W = 720, H = 400;
const ROAD = [[80, 345], [330, 322], [180, 268], [440, 218], [320, 170], [520, 128], [600, 74]];

function smooth(pts: number[][]) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}
const PATH = smooth(ROAD);
// до замера по кривой (SSR) — приближение по ломаной
const SEG = ROAD.slice(1).map((p, i) => Math.hypot(p[0] - ROAD[i][0], p[1] - ROAD[i][1]));
const TOT = SEG.reduce((a, b) => a + b, 0);
function approx(f: number) {
  let L = Math.max(0, Math.min(1, f)) * TOT;
  for (let i = 0; i < SEG.length; i++) { if (L <= SEG[i]) { const t = L / SEG[i]; return [ROAD[i][0] + (ROAD[i + 1][0] - ROAD[i][0]) * t, ROAD[i][1] + (ROAD[i + 1][1] - ROAD[i][1]) * t]; } L -= SEG[i]; }
  return ROAD[ROAD.length - 1];
}

/** Карта-гора: путь от точки A к цели, участки-флажки, мини-точки (темы), отметки юнитов, «ты здесь». */
export function Mountain({ stages, done, start, ini, label, units = [], ci, sel, onSelect, onPoint, selPoint, studentView }: {
  stages: MStage[]; done: number; start: string; ini: string; label: string; units?: string[]; ci: number; sel?: number; onSelect?: (i: number) => void;
  onPoint?: (id: string) => void; selPoint?: string | null; studentView?: boolean; h?: number;
}) {
  const { t } = useT();
  const id = useId().replace(/:/g, "");
  const total = stages.reduce((a, s) => a + s.hours, 0) || 1;
  const frac = Math.min(1, done / total);
  // доли пути: конец каждого участка, середина каждой точки
  const marks = useMemo(() => {
    let cum = 0;
    const flags: number[] = [], pts: { p: MPoint; f: number; end: number; si: number }[] = [];
    stages.forEach((s, si) => {
      const ps = s.points ?? [];
      const sum = ps.reduce((a, p) => a + p.hours, 0) || 1;
      let c = cum;
      for (const p of ps) { const h = (p.hours / sum) * s.hours; pts.push({ p, f: (c + h / 2) / total, end: (c + h) / total, si }); c += h; }
      cum += s.hours; flags.push(cum / total);
    });
    return { flags, pts };
  }, [stages, total]);
  const ref = useRef<SVGPathElement>(null);
  const [len, setLen] = useState<number | null>(null);
  useLayoutEffect(() => { const el = ref.current; if (el && typeof el.getTotalLength === "function") setLen(el.getTotalLength()); }, []);
  const at = (f: number) => { const el = ref.current; if (len && el) { const q = el.getPointAtLength(len * Math.max(0, Math.min(1, f))); return [q.x, q.y]; } return approx(f); };
  const me = at(frac);
  const [hov, setHov] = useState<number | null>(null);
  const yw = Math.max(96, label.length * 7.4 + 24);
  const trees = [[40, 372], [110, 380], [190, 366], [560, 376], [630, 362], [690, 372], [20, 350], [660, 336]];
  const hp = hov !== null ? marks.pts[hov] : null;
  const hpos = hp ? at(hp.f) : null;
  return (
    <div className="mtnbox">
      <svg viewBox={`0 0 ${W} ${H}`} className="mtn" role="img" aria-label={label} style={{ ["--to" as string]: String(100 - frac * 100) }}>
        <defs>
          <linearGradient id={`sk${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#DDEBFF" /><stop offset=".7" stopColor="#F4F8FF" /><stop offset="1" stopColor="#FFFFFF" /></linearGradient>
          <radialGradient id={`sun${id}`} cx=".14" cy=".16" r=".2"><stop offset="0" stopColor="#FFE7A3" stopOpacity=".95" /><stop offset="1" stopColor="#FFE7A3" stopOpacity="0" /></radialGradient>
          <linearGradient id={`mA${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#B7CDEF" /><stop offset="1" stopColor="#E3ECFA" /></linearGradient>
          <linearGradient id={`mB${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7FA6DC" /><stop offset=".55" stopColor="#A9C6EE" /><stop offset="1" stopColor="#DCE8FA" /></linearGradient>
          <linearGradient id={`mC${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#CFE6D6" /><stop offset="1" stopColor="#EEF7F0" /></linearGradient>
          <linearGradient id={`tr${id}`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#34C759" /><stop offset=".55" stopColor="#0A84FF" /><stop offset="1" stopColor="#BF5AF2" /></linearGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#sk${id})`} /><rect width={W} height={H} fill={`url(#sun${id})`} />
        <circle cx={100} cy={62} r="20" fill="#FFD66B" opacity=".9" />
        <g fill="#FFFFFF" opacity=".85"><ellipse cx="230" cy="48" rx="40" ry="10" /><ellipse cx="258" cy="41" rx="24" ry="9" /><ellipse cx="420" cy="34" rx="32" ry="8" /></g>
        <path d="M0,400 L0,250 L90,200 L170,232 L280,160 L360,184 L450,140 L520,160 L560,130 L720,190 L720,400Z" fill={`url(#mA${id})`} opacity=".8" />
        <path d="M0,400 L0,330 C60,300 110,240 160,215 C230,180 300,150 380,118 C450,92 540,70 600,58 C630,52 650,56 672,70 C700,88 715,110 720,120 L720,400Z" fill={`url(#mB${id})`} />
        <path d="M560,68 C580,61 592,58 600,58 C630,52 650,56 672,70 L662,76 L648,68 L634,78 L620,68 L606,78 L592,70 L578,78Z" fill="#FFFFFF" />
        <path d="M0,400 L0,346 C120,326 240,336 360,318 C480,300 600,326 720,306 L720,400Z" fill={`url(#mC${id})`} />
        {trees.map(([x, y], i) => (
          <g key={i} transform={`translate(${x},${y}) scale(${0.8 + (i % 3) * 0.2})`}><path d="M0,-26 L10,-6 L5,-6 L13,8 L-13,8 L-5,-6 L-10,-6Z" fill={i % 2 ? "#7FB79A" : "#9CCBB0"} /><rect x="-1.5" y="8" width="3" height="5" fill="#B39B84" /></g>
        ))}
        <path d={PATH} className="road" ref={ref} /><path d={PATH} className="roadc" />
        <path d={PATH} className="trk" stroke={`url(#tr${id})`} pathLength={100} />
        <g transform={`translate(${ROAD[0][0]},${ROAD[0][1]})`}>
          <title>{start}</title>
          <circle r="19" className="astart" /><text y="7" textAnchor="middle" className="atext">A</text>
          <g transform="translate(0,32)"><rect x="-24" y="-11" width="48" height="22" rx="11" className="alvl" /><text y="4" textAnchor="middle" className="alvlt">{start}</text></g>
        </g>
        {units.map((u, k) => {
          const f = (k + 1) / (units.length + 1), [x, y] = at(f);
          return <g key={k} className={`ut ${f <= frac ? "done" : ""}`} transform={`translate(${x},${y})`}><title>{u}</title><rect x="-4" y="-4" width="8" height="8" rx="2.5" transform="rotate(45)" className="utd" /></g>;
        })}
        {/* мини-точки: темы участков */}
        {marks.pts.map((m, k) => {
          const [x, y] = at(m.f);
          const has = !!m.p.ok && Object.keys(m.p.ok).length > 0;
          const cls = `mp ${m.end <= frac + 1e-6 ? "done" : ""} ${has ? "has" : ""} ${selPoint === m.p.id ? "sel" : ""} ${onPoint ? "click" : ""}`;
          return (
            <g key={m.p.id} className={cls} transform={`translate(${x},${y})`} role={onPoint ? "button" : undefined} tabIndex={onPoint ? 0 : undefined} aria-label={m.p.title}
              onMouseEnter={() => setHov(k)} onMouseLeave={() => setHov((h) => (h === k ? null : h))} onFocus={() => setHov(k)} onBlur={() => setHov(null)}
              onClick={onPoint ? () => onPoint(m.p.id) : undefined} onKeyDown={onPoint ? (e) => { if (e.key === "Enter" || e.key === " ") onPoint(m.p.id); } : undefined}>
              <circle r="11" fill="transparent" /><circle r="5.5" className="mpd" />
            </g>
          );
        })}
        {stages.map((s, i) => {
          const [x, y] = at(marks.flags[i]);
          const st = s.passed ? "done" : i === ci ? "current" : "next";
          return (
            <g key={i} className={`nd ${st} ${sel === i ? "sel" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={`${s.lvl}: ${s.title}`}
              onClick={onSelect ? () => onSelect(i) : undefined} onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") onSelect(i); } : undefined}>
              <title>{`${s.title}${s.kind === "gaps" ? ` (${t("mtn.gaps")})` : s.kind === "consolidate" ? ` (${t("mtn.cons")})` : ""} · ${s.hours} ${t("mtn.h")}`}</title>
              <ellipse cx={x} cy={y + 2} rx="9" ry="3" className="pinsh" />
              <g transform={`translate(${x},${y})`}>
                <path d="M0,0 C-4,-8 -16,-14 -16,-27 A16,16 0 1 1 16,-27 C16,-14 4,-8 0,0Z" className="pin" />
                <text y="-23" textAnchor="middle" className="pint">{s.kind === "gaps" ? `→${s.lvl}` : s.lvl.length > 5 ? s.lvl.slice(0, 5) : s.lvl}</text>
                {(s.kind === "gaps" || s.kind === "consolidate") && (() => { const tx = s.kind === "gaps" ? t("mtn.gaps") : t("mtn.cons"); const w = tx.length * 6.2 + 14; return (
                  <g transform="translate(0,14)"><rect x={-w / 2} y="-9" width={w} height="18" rx="9" className={`ptag ${s.kind}`} /><text y="4" textAnchor="middle" className="ptagt">{tx}</text></g>
                ); })()}
                {st === "done" && <g transform="translate(12,-40)"><circle r="7" fill="#34C759" stroke="#FFFFFF" strokeWidth="2" /><path d="M-3,0 l2,2 l4,-4.5" stroke="#FFFFFF" strokeWidth="1.8" fill="none" strokeLinecap="round" /></g>}
              </g>
            </g>
          );
        })}
        <g transform={`translate(${ROAD[ROAD.length - 1][0] + 34},${ROAD[ROAD.length - 1][1] - 50})`}><path d="M0,0 v38" stroke="#1C1C1E" strokeWidth="2.5" /><path d="M0,0 h30 l-7,8 l7,8 h-30z" fill="#FF375F" /></g>
        <g transform={`translate(${me[0]},${me[1]})`} className="hiker"><circle r="21" fill="#FFFFFF" opacity=".95" /><circle r="17" fill="#FF9500" /><text y="5" textAnchor="middle" className="hkini">{ini}</text></g>
        <g transform={`translate(${me[0]},${me[1] + 36})`}><rect x={-yw / 2} y="-12" width={yw} height="24" rx="12" fill="#1C1C1E" /><text y="4" textAnchor="middle" className="metx">{label}</text></g>
      </svg>
      {hp && hpos && (
        <div className={`mtip ${hpos[1] < 150 ? "below" : ""}`} style={{ left: `${(hpos[0] / W) * 100}%`, top: `${(hpos[1] / H) * 100}%`, ["--tx" as string]: hpos[0] < W * 0.3 ? "-12%" : hpos[0] > W * 0.7 ? "-88%" : "-50%" }}>
          <b>{hp.p.title}</b>
          <span className="muted">{stages[hp.si]?.title}{hp.p.level ? ` · ${hp.p.level}` : ""}{studentView ? "" : ` · ${hp.p.hours} ${t("mtn.h")}`}</span>
          {hp.p.ok && Object.keys(hp.p.ok).length > 0 && <span className="mtip-ok">{studentView ? t("mtn.okS") : t("mtn.okT")}</span>}
        </div>
      )}
    </div>
  );
}
