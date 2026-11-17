// Персонажи для аватарки ученика без фото: 12 зверят в одном стиле (плоско, мягкие тени, блики в глазах).
// Рисунки свои, viewBox 0 0 100 100; фон кружка — свой у каждого.

const eyes = (lx: number, rx: number, y: number, r = 3.6) => (
  <>
    <circle cx={lx} cy={y} r={r} fill="#2B1B10" /><circle cx={rx} cy={y} r={r} fill="#2B1B10" />
    <circle cx={lx + r * 0.35} cy={y - r * 0.4} r={r * 0.35} fill="#FFFFFF" /><circle cx={rx + r * 0.35} cy={y - r * 0.4} r={r * 0.35} fill="#FFFFFF" />
  </>
);
const blush = (lx: number, rx: number, y: number, c = "#FFB3C1") => (
  <><ellipse cx={lx} cy={y} rx="5" ry="3.2" fill={c} opacity=".7" /><ellipse cx={rx} cy={y} rx="5" ry="3.2" fill={c} opacity=".7" /></>
);

export const CHARACTERS: Record<string, { ru: string; en: string; bg: string; art: React.ReactNode }> = {
  fox: { ru: "Лис", en: "Fox", bg: "#FFE7D4", art: (<>
    <path d="M18 24l20 20h24l20-20-5 38c-5 18-17 26-27 26S28 80 23 62z" fill="#F28C38" />
    <path d="M22 30l13 13-7 8zM78 30L65 43l7 8z" fill="#8A4416" />
    <path d="M26 60c6 16 14 24 24 24s18-8 24-24c-8 7-16 10-24 10s-16-3-24-10z" fill="#FFF4EA" />
    <path d="M50 44c-8 0-14 4-17 10 6-3 11-4 17-4s11 1 17 4c-3-6-9-10-17-10z" fill="#E9782A" opacity=".5" />
    {eyes(39, 61, 57)}{blush(32, 68, 66)}
    <ellipse cx="50" cy="71" rx="4.4" ry="3.2" fill="#2B1B10" />
  </>) },
  owl: { ru: "Сова", en: "Owl", bg: "#EEE5FF", art: (<>
    <path d="M24 38l5-18 12 13zM76 38l-5-18-12 13z" fill="#7A5236" />
    <ellipse cx="50" cy="62" rx="31" ry="32" fill="#8B5E3C" />
    <ellipse cx="50" cy="78" rx="19" ry="16" fill="#E2C29F" />
    <path d="M42 76q3 3 6 0M52 76q3 3 6 0M47 83q3 3 6 0" stroke="#C49A70" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <circle cx="38" cy="52" r="12" fill="#FFFFFF" /><circle cx="62" cy="52" r="12" fill="#FFFFFF" />
    {eyes(39, 61, 53, 5.4)}
    <path d="M45.5 61h9L50 69z" fill="#F2A33A" />
  </>) },
  cat: { ru: "Кот", en: "Cat", bg: "#E4EEFF", art: (<>
    <path d="M24 50l3-30 20 15zM76 50l-3-30-20 15z" fill="#9AA3B2" />
    <path d="M29 42l2-14 11 8zM71 42l-2-14-11 8z" fill="#F6B6C6" />
    <circle cx="50" cy="61" r="29" fill="#A3ACBB" />
    <path d="M50 32c-4 6-4 12 0 16 4-4 4-10 0-16z" fill="#8C95A5" />
    {eyes(39, 61, 58, 3.8)}{blush(31, 69, 67)}
    <path d="M46 66h8l-4 4z" fill="#F08AA4" />
    <path d="M50 70v3M50 73q-4 3-7 0M50 73q4 3 7 0" stroke="#5C6370" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    <path d="M28 66l-12-2M28 71l-12 2M72 66l12-2M72 71l12 2" stroke="#6B7383" strokeWidth="1.3" strokeLinecap="round" />
  </>) },
  bear: { ru: "Медведь", en: "Bear", bg: "#FFF0D8", art: (<>
    <circle cx="27" cy="35" r="11" fill="#8E5F36" /><circle cx="73" cy="35" r="11" fill="#8E5F36" />
    <circle cx="27" cy="35" r="5.5" fill="#D9B48F" /><circle cx="73" cy="35" r="5.5" fill="#D9B48F" />
    <circle cx="50" cy="60" r="29" fill="#9C6B3F" />
    <ellipse cx="50" cy="71" rx="14" ry="11" fill="#E8CBA6" />
    {eyes(39, 61, 55)}{blush(30, 70, 65)}
    <ellipse cx="50" cy="66" rx="5" ry="3.8" fill="#2B1B10" />
    <path d="M50 70v3M50 73q-3 3-6 1M50 73q3 3 6 1" stroke="#2B1B10" strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </>) },
  panda: { ru: "Панда", en: "Panda", bg: "#E5F8EC", art: (<>
    <circle cx="27" cy="35" r="11" fill="#22252B" /><circle cx="73" cy="35" r="11" fill="#22252B" />
    <circle cx="50" cy="61" r="29" fill="#FFFFFF" />
    <ellipse cx="38" cy="58" rx="8" ry="10" fill="#22252B" transform="rotate(-25 38 58)" />
    <ellipse cx="62" cy="58" rx="8" ry="10" fill="#22252B" transform="rotate(25 62 58)" />
    <circle cx="39" cy="57" r="3" fill="#FFFFFF" /><circle cx="61" cy="57" r="3" fill="#FFFFFF" />
    <circle cx="40" cy="56" r="1.4" fill="#22252B" /><circle cx="62" cy="56" r="1.4" fill="#22252B" />
    {blush(30, 70, 69)}
    <ellipse cx="50" cy="69" rx="4.4" ry="3.2" fill="#22252B" />
    <path d="M50 72q-3 3-6 1M50 72q3 3 6 1" stroke="#22252B" strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </>) },
  bunny: { ru: "Зайка", en: "Bunny", bg: "#FFE6EE", art: (<>
    <ellipse cx="38" cy="26" rx="8" ry="21" fill="#EDE8F2" /><ellipse cx="62" cy="26" rx="8" ry="21" fill="#EDE8F2" />
    <ellipse cx="38" cy="27" rx="4" ry="15" fill="#F8C3D2" /><ellipse cx="62" cy="27" rx="4" ry="15" fill="#F8C3D2" />
    <circle cx="50" cy="63" r="27" fill="#F6F3F9" />
    {eyes(40, 60, 60)}{blush(32, 68, 69)}
    <ellipse cx="50" cy="68" rx="3.6" ry="2.6" fill="#F08AA4" />
    <path d="M50 70.5v3M50 73.5q-3 3-6 1M50 73.5q3 3 6 1" stroke="#B9A9BE" strokeWidth="1.3" fill="none" strokeLinecap="round" />
  </>) },
  penguin: { ru: "Пингвин", en: "Penguin", bg: "#DCF2FF", art: (<>
    <circle cx="50" cy="58" r="31" fill="#2C3E50" />
    <path d="M28 63q2-24 22-15 20-9 22 15-4 23-22 23T28 63z" fill="#FFFFFF" />
    {eyes(41, 59, 58)}{blush(33, 67, 68)}
    <path d="M44 65h12l-6 7z" fill="#F2A33A" />
  </>) },
  frog: { ru: "Лягушонок", en: "Frog", bg: "#E2F7D5", art: (<>
    <circle cx="33" cy="40" r="13" fill="#5CC46B" /><circle cx="67" cy="40" r="13" fill="#5CC46B" />
    <ellipse cx="50" cy="63" rx="33" ry="25" fill="#5CC46B" />
    <ellipse cx="50" cy="72" rx="22" ry="12" fill="#86D893" />
    <circle cx="33" cy="40" r="8" fill="#FFFFFF" /><circle cx="67" cy="40" r="8" fill="#FFFFFF" />
    {eyes(34, 66, 41, 4)}
    <path d="M36 66q14 10 28 0" stroke="#2E7D32" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    {blush(28, 72, 63, "#FF9DB0")}
  </>) },
  lion: { ru: "Лев", en: "Lion", bg: "#FFF3C9", art: (<>
    <circle cx="50" cy="57" r="35" fill="#E0832B" />
    <circle cx="50" cy="57" r="29" fill="#EE9C3E" />
    <circle cx="33" cy="38" r="6" fill="#F7C65A" /><circle cx="67" cy="38" r="6" fill="#F7C65A" />
    <circle cx="50" cy="60" r="23" fill="#F7C65A" />
    {eyes(41, 59, 56)}{blush(34, 66, 66)}
    <ellipse cx="50" cy="69" rx="9" ry="7" fill="#FFE7A8" />
    <path d="M46.5 65h7L50 69z" fill="#7A3A12" />
  </>) },
  koala: { ru: "Коала", en: "Koala", bg: "#ECEFF5", art: (<>
    <circle cx="23" cy="45" r="15" fill="#A7AFBD" /><circle cx="77" cy="45" r="15" fill="#A7AFBD" />
    <circle cx="23" cy="45" r="8.5" fill="#E8EBF1" /><circle cx="77" cy="45" r="8.5" fill="#E8EBF1" />
    <circle cx="50" cy="61" r="27" fill="#AEB6C4" />
    {eyes(40, 60, 56)}{blush(32, 68, 70)}
    <ellipse cx="50" cy="66" rx="7.5" ry="9.5" fill="#3A3F4A" />
    <ellipse cx="48" cy="62" rx="2" ry="3" fill="#6B7180" />
  </>) },
  dog: { ru: "Пёс", en: "Dog", bg: "#FFEEDD", art: (<>
    <circle cx="50" cy="59" r="27" fill="#ECC08F" />
    <ellipse cx="25" cy="55" rx="9" ry="19" fill="#9C6B3F" transform="rotate(14 25 55)" />
    <ellipse cx="75" cy="55" rx="9" ry="19" fill="#9C6B3F" transform="rotate(-14 75 55)" />
    <circle cx="61" cy="50" r="7.5" fill="#D6A16C" />
    {eyes(41, 59, 56)}{blush(34, 66, 66)}
    <ellipse cx="50" cy="66" rx="5.4" ry="4" fill="#2B1B10" />
    <path d="M45 71q5 9 10 0z" fill="#F08AA4" />
  </>) },
  unicorn: { ru: "Единорог", en: "Unicorn", bg: "#F4E8FF", art: (<>
    <path d="M50 10l6.5 25h-13z" fill="#F6C343" />
    <path d="M46 18l9 3M45 25l10 3" stroke="#E0A92A" strokeWidth="1.5" />
    <circle cx="50" cy="61" r="27" fill="#FFFFFF" />
    <path d="M27 50q2-18 22-18-8 6-8 14 0 8 4 14-14 4-18-10z" fill="#C58CF5" />
    <path d="M30 44q6-12 20-12" stroke="#FF8DB5" strokeWidth="6" fill="none" strokeLinecap="round" />
    <path d="M42 58q4 4 8 0M54 58q4 4 8 0" stroke="#2B1B10" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    {blush(40, 64, 67)}
    <path d="M47 70q5 3 10 0" stroke="#C9A5D8" strokeWidth="1.6" fill="none" strokeLinecap="round" />
  </>) },
};
export const CHARACTER_KEYS = Object.keys(CHARACTERS);

/** Персонаж по умолчанию — один и тот же для ученика (по id), пока он не выбрал своего. */
export function defaultCharacter(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CHARACTER_KEYS[h % CHARACTER_KEYS.length];
}

export function CharacterArt({ k, size }: { k: string; size: number }) {
  const c = CHARACTERS[k] ?? CHARACTERS.owl;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ display: "block", background: c.bg }}>
      {c.art}
    </svg>
  );
}
