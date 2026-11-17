import { ICONS, METALS, type IconKey, type Metal } from "@/lib/awards/catalog";
import { CharacterArt, defaultCharacter } from "./Characters";

const HEX = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)";

/** Медаль статуса: титул — шестигранник, поощрение — круг; объёмный металл с выпуклым значком. */
export function Medal({ icon, color, size = 40, shape = "hex", muted = false }: { icon: string; color: string; size?: number; shape?: "hex" | "circle"; muted?: boolean }) {
  const m = METALS[(color as Metal) in METALS ? (color as Metal) : "gold"];
  const d = ICONS[(icon as IconKey) in ICONS ? (icon as IconKey) : "star"];
  const inner = Math.round(size * 0.8);
  const clip = shape === "hex" ? HEX : undefined;
  const radius = shape === "circle" ? "50%" : undefined;
  return (
    <span className={`medal ${muted ? "muted" : ""}`} style={{ width: size, height: shape === "hex" ? Math.round(size * 1.06) : size, filter: muted ? "grayscale(.85) opacity(.65)" : `drop-shadow(0 ${Math.max(2, size / 12)}px ${Math.max(3, size / 7)}px ${m.shadow})` }} aria-hidden="true">
      <span style={{ width: "100%", height: "100%", clipPath: clip, borderRadius: radius, background: m.ring, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: shape === "circle" ? "inset 0 1.5px 1.5px rgba(255,255,255,.85), inset 0 -3px 6px rgba(0,0,0,.2)" : undefined }}>
        <span style={{ width: inner, height: shape === "hex" ? Math.round(inner * 1.06) : inner, clipPath: clip, borderRadius: radius, background: m.face, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: shape === "circle" ? "inset 0 2px 5px rgba(0,0,0,.25)" : undefined }}>
          <svg width={Math.round(size * 0.46)} height={Math.round(size * 0.46)} viewBox="0 0 24 24" fill="none" stroke={m.ink} strokeWidth={size < 30 ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.45))" }}><path d={d} /></svg>
        </span>
      </span>
    </span>
  );
}

/** Золотая корона — висит набок на аватарке, когда у ученика есть главный титул. */
export function Crown({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.77} viewBox="0 0 60 46" aria-hidden="true" style={{ filter: "drop-shadow(0 3px 4px rgba(140,90,0,.35))" }}>
      <defs><linearGradient id="vb-crown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFF1B3" /><stop offset=".45" stopColor="#F6C343" /><stop offset="1" stopColor="#C98A12" /></linearGradient></defs>
      <path d="M6 14l12 10 12-18 12 18 12-10-5 26H11L6 14z" fill="url(#vb-crown)" stroke="#B37A0A" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="11" y="36" width="38" height="6" rx="2" fill="#E3A82A" stroke="#B37A0A" strokeWidth="1.2" />
      <circle cx="6" cy="13" r="3.4" fill="#FFE27A" stroke="#B37A0A" /><circle cx="30" cy="5" r="3.6" fill="#FFE27A" stroke="#B37A0A" /><circle cx="54" cy="13" r="3.4" fill="#FFE27A" stroke="#B37A0A" />
      <circle cx="30" cy="30" r="3" fill="#4F8DF5" stroke="#1F4FBF" strokeWidth=".8" />
    </svg>
  );
}

/** Аватарка ученика: фото (своё или из Telegram) или персонаж; с короной — когда есть главный титул. */
export function StudentAvatar({ id, avatar, size = 40, crown = false, ring = false }: { id: string; avatar: string | null; size?: number; crown?: boolean; ring?: boolean }) {
  const ch = avatar?.startsWith("char:") ? avatar.slice(5) : null;
  const photo = avatar && !ch ? avatar : null;
  return (
    <span className="stavatar" style={{ width: size, height: size }}>
      <span className="stavatar-in" style={{ width: size, height: size, boxShadow: ring || crown ? `0 0 0 ${Math.max(2, size / 28)}px var(--surface), 0 0 0 ${Math.max(3, size / 18)}px #F2CD6B` : undefined }}>
        {photo ? <img src={photo} alt="" width={size} height={size} /> : <CharacterArt k={ch ?? defaultCharacter(id)} size={size} />}
      </span>
      {crown && <span className="stavatar-crown" style={{ left: -size * 0.1, top: -size * 0.26 }}><Crown size={size * 0.52} /></span>}
    </span>
  );
}
