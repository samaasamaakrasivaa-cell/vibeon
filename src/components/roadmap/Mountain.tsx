"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";

type MStage = { lvl: string; title: string; hours: number; passed?: unknown };

function smooth(pts: number[][]) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Карта-гора: путь от точки A к цели, этапы-флажки, отметки юнитов, «ты здесь». Пройденное закрашивается с анимацией. */
export function Mountain({ stages, done, start, ini, label, units = [], ci, sel, onSelect, h = 440 }: {
  stages: MStage[]; done: number; start: string; ini: string; label: string; units?: string[]; ci: number; sel?: number; onSelect?: (i: number) => void; h?: number;
}) {
  const id = useId().replace(/:/g, "");
  const n = Math.max(1, stages.length);
  const W = 720, H = h, base = H - 70;
  const X = [330, 190, 430, 560, 640, 660];
  const pts: number[][] = [[80, base]];
  for (let i = 1; i <= n; i++) pts.push([X[Math.min(i - 1, 5)], base - i * ((H - 170) / n)]);
  const mids = Array.from({ length: n }, (_, i) => { const a = pts[i], b = pts[i + 1], side = i % 2 ? -1 : 1; return [(a[0] + b[0]) / 2 + side * 90, (a[1] + b[1]) / 2]; });
  const ex: number[][] = [];
  for (let i = 0; i < n; i++) ex.push(pts[i], mids[i]);
  ex.push(pts[n]);
  const path = smooth(ex);
  const total = stages.reduce((a, s) => a + s.hours, 0) || 1;
  const frac = Math.min(1, done / total);
  let cum = 0;
  const cumF = [0, ...stages.map((s) => (cum += s.hours) / total)];
  const posAt = (f: number) => {
    for (let i = 0; i < n; i++) if (f <= cumF[i + 1]) {
      const t = (f - cumF[i]) / Math.max(1e-6, cumF[i + 1] - cumF[i]), A = pts[i], M = mids[i], B = pts[i + 1];
      return [(1 - t) * (1 - t) * A[0] + 2 * (1 - t) * t * M[0] + t * t * B[0], (1 - t) * (1 - t) * A[1] + 2 * (1 - t) * t * M[1] + t * t * B[1]];
    }
    return pts[n];
  };
  // Точно по нарисованной кривой: длины пути до каждого флажка, затем «ты здесь» и закраска — по часам внутри этапа.
  const ref = useRef<SVGPathElement>(null);
  const [exact, setExact] = useState<{ me: number[]; off: number; units: number[][] } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.getTotalLength !== "function") return;
    const L = el.getTotalLength(), N = 600;
    const samples = Array.from({ length: N + 1 }, (_, k) => { const q = el.getPointAtLength((L * k) / N); return [q.x, q.y]; });
    let from = 0;
    const at = [0];
    for (let i = 1; i <= n; i++) {
      let best = from, bd = Infinity;
      for (let k = from; k <= N; k++) { const d = (samples[k][0] - pts[i][0]) ** 2 + (samples[k][1] - pts[i][1]) ** 2; if (d < bd) { bd = d; best = k; } }
      at.push((best / N) * L); from = best;
    }
    const lenAt = (f: number) => { for (let i = 0; i < n; i++) if (f <= cumF[i + 1]) { const t = (f - cumF[i]) / Math.max(1e-6, cumF[i + 1] - cumF[i]); return at[i] + t * (at[i + 1] - at[i]); } return L; };
    const pt = (len: number) => { const q = el.getPointAtLength(len); return [q.x, q.y]; };
    const myLen = lenAt(frac);
    setExact({ me: pt(myLen), off: 100 - (myLen / L) * 100, units: units.map((_, k) => pt(lenAt((k + 1) / (units.length + 1)))) });
  }, [path, frac, units.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = exact?.me ?? posAt(frac);
  const yw = Math.max(96, label.length * 7.4 + 24);
  const trees = [[40, H - 40], [110, H - 30], [180, H - 46], [560, H - 36], [630, H - 50], [690, H - 40], [20, H - 70], [660, H - 80]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mtn" role="img" aria-label={label} style={{ ["--to" as string]: String(exact ? exact.off : 100 - frac * 100) }}>
      <defs>
        <linearGradient id={`sk${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#DDEBFF" /><stop offset=".7" stopColor="#F4F8FF" /><stop offset="1" stopColor="#FFFFFF" /></linearGradient>
        <radialGradient id={`sun${id}`} cx=".82" cy=".16" r=".22"><stop offset="0" stopColor="#FFE7A3" stopOpacity=".95" /><stop offset="1" stopColor="#FFE7A3" stopOpacity="0" /></radialGradient>
        <linearGradient id={`mA${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#B7CDEF" /><stop offset="1" stopColor="#E3ECFA" /></linearGradient>
        <linearGradient id={`mB${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7FA6DC" /><stop offset=".55" stopColor="#A9C6EE" /><stop offset="1" stopColor="#DCE8FA" /></linearGradient>
        <linearGradient id={`mC${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#CFE6D6" /><stop offset="1" stopColor="#EEF7F0" /></linearGradient>
        <linearGradient id={`tr${id}`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#34C759" /><stop offset=".55" stopColor="#0A84FF" /><stop offset="1" stopColor="#BF5AF2" /></linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#sk${id})`} /><rect width={W} height={H} fill={`url(#sun${id})`} />
      <circle cx={W * 0.82} cy={H * 0.16} r="22" fill="#FFD66B" opacity=".9" />
      <g fill="#FFFFFF" opacity=".85"><ellipse cx="140" cy="64" rx="44" ry="11" /><ellipse cx="172" cy="56" rx="28" ry="11" /><ellipse cx="430" cy="42" rx="36" ry="9" /><ellipse cx="456" cy="36" rx="20" ry="8" /></g>
      <path d={`M0,${H} L0,${H - 150} L90,${H - 210} L170,${H - 170} L280,${H - 270} L360,${H - 230} L450,${H - 300} L540,${H - 250} L620,${H - 310} L720,${H - 240} L720,${H}Z`} fill={`url(#mA${id})`} opacity=".85" />
      <path d={`M0,${H} L0,${H - 90} C150,${H - 130} 250,${H - 170} 360,${H - 240} C450,${H - 300} 540,${H - 350} 620,${H - 390} C640,${H - 400} 666,${H - 404} 690,${H - 388} L720,${H - 360} L720,${H}Z`} fill={`url(#mB${id})`} />
      <path d={`M620,${H - 390} C640,${H - 400} 666,${H - 404} 690,${H - 388} L705,${H - 372} L688,${H - 366} L676,${H - 376} L660,${H - 364} L646,${H - 374} L632,${H - 366}Z`} fill="#FFFFFF" />
      <path d={`M0,${H} L0,${H - 60} C120,${H - 80} 240,${H - 70} 360,${H - 90} C480,${H - 110} 600,${H - 80} 720,${H - 100} L720,${H}Z`} fill={`url(#mC${id})`} />
      {trees.map(([x, y], i) => (
        <g key={i} transform={`translate(${x},${y}) scale(${0.8 + (i % 3) * 0.2})`}><path d="M0,-26 L10,-6 L5,-6 L13,8 L-13,8 L-5,-6 L-10,-6Z" fill={i % 2 ? "#7FB79A" : "#9CCBB0"} /><rect x="-1.5" y="8" width="3" height="5" fill="#B39B84" /></g>
      ))}
      <path d={path} className="road" ref={ref} /><path d={path} className="roadc" />
      <path d={path} className="trk" stroke={`url(#tr${id})`} pathLength={100} />
      <g transform={`translate(${pts[0][0]},${pts[0][1]})`}>
        <title>{start}</title>
        <circle r="19" className="astart" /><text y="7" textAnchor="middle" className="atext">A</text>
        <g transform="translate(0,34)"><rect x="-24" y="-11" width="48" height="22" rx="11" className="alvl" /><text y="4" textAnchor="middle" className="alvlt">{start}</text></g>
      </g>
      {units.map((u, k) => {
        const f = (k + 1) / (units.length + 1), [x, y] = exact?.units[k] ?? posAt(f);
        return <g key={k} className={`ut ${f <= frac ? "done" : ""}`} transform={`translate(${x},${y})`}><title>{u}</title><circle r="9" fill="transparent" /><rect x="-4" y="-4" width="8" height="8" rx="2.5" transform="rotate(45)" className="utd" /></g>;
      })}
      {stages.map((s, i) => {
        const [x, y] = pts[i + 1];
        const st = s.passed ? "done" : i === ci ? "current" : "next";
        return (
          <g key={i} className={`nd ${st} ${sel === i ? "sel" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={`${s.lvl}: ${s.title}`}
            onClick={onSelect ? () => onSelect(i) : undefined} onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") onSelect(i); } : undefined}>
            <title>{`${s.lvl} · ${s.title} · ${s.hours} h`}</title>
            <ellipse cx={x} cy={y + 2} rx="9" ry="3" className="pinsh" />
            <g transform={`translate(${x},${y})`}>
              <path d="M0,0 C-4,-8 -16,-14 -16,-27 A16,16 0 1 1 16,-27 C16,-14 4,-8 0,0Z" className="pin" />
              <text y="-23" textAnchor="middle" className="pint">{s.lvl.length > 5 ? s.lvl.slice(0, 5) : s.lvl}</text>
              {st === "done" && <g transform="translate(12,-40)"><circle r="7" fill="#34C759" stroke="#FFFFFF" strokeWidth="2" /><path d="M-3,0 l2,2 l4,-4.5" stroke="#FFFFFF" strokeWidth="1.8" fill="none" strokeLinecap="round" /></g>}
            </g>
          </g>
        );
      })}
      <g transform={`translate(${pts[n][0]},${pts[n][1] - 64})`}><path d="M0,0 v38" stroke="#1C1C1E" strokeWidth="2.5" /><path d="M0,0 h30 l-7,8 l7,8 h-30z" fill="#FF375F" /></g>
      <g transform={`translate(${me[0]},${me[1]})`} className="hiker"><circle r="21" fill="#FFFFFF" opacity=".95" /><circle r="17" fill="#FF9500" /><text y="5" textAnchor="middle" className="hkini">{ini}</text></g>
      <g transform={`translate(${me[0]},${me[1] + 36})`}><rect x={-yw / 2} y="-12" width={yw} height="24" rx="12" fill="#1C1C1E" /><text y="4" textAnchor="middle" className="metx">{label}</text></g>
    </svg>
  );
}
