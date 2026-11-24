// Скрипт аудирования → реплики для озвучки. Без зависимостей от сервера (проверяется тестами).

export type Part = { speaker: number; name: string | null; text: string };

/** «Anna: Hi!» — реплика собеседника; строки без имени — продолжение текущего; длинные куски режутся по предложениям. */
export function parseScript(script: string): Part[] {
  const names: string[] = [];
  const out: Part[] = [];
  let cur: Part | null = null;
  for (const raw of script.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) { cur = null; continue; }
    const m = /^([A-Z][\p{L}.'’ -]{0,24}|[A-Z])\s*:\s*(.+)$/u.exec(line);
    if (m) {
      const name = m[1].trim();
      let i = names.indexOf(name);
      if (i < 0) { names.push(name); i = names.length - 1; }
      cur = { speaker: i, name, text: m[2].trim() };
      out.push(cur);
    } else if (cur) cur.text += ` ${line}`;
    else { cur = { speaker: 0, name: null, text: line }; out.push(cur); }
  }
  // SpeechKit берёт за раз ограниченный объём — режем длинные реплики по предложениям
  const res: Part[] = [];
  for (const p of out) {
    const sentences = p.text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [p.text];
    let buf = "";
    for (const s of sentences) {
      if ((buf + s).length > 700 && buf) { res.push({ ...p, text: buf.trim() }); buf = ""; }
      buf += s;
    }
    if (buf.trim()) res.push({ ...p, text: buf.trim() });
  }
  return res.filter((p) => /[\p{L}\p{N}]/u.test(p.text));
}

const stripId3 = (c: Buffer) => {
  if (c.subarray(0, 3).toString() !== "ID3") return c;
  const size = ((c[6] & 0x7f) << 21) | ((c[7] & 0x7f) << 14) | ((c[8] & 0x7f) << 7) | (c[9] & 0x7f);
  return c.subarray(10 + size);
};

const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];

/** Кадр тишины MP3 с параметрами первого кадра записи (MPEG-1 Layer III): нулевая побочная информация — декодер даёт тишину. */
function silentFrame(c: Buffer): { frame: Buffer; ms: number } | null {
  const i = c.findIndex((b, k) => b === 0xff && (c[k + 1] & 0xfe) === 0xfa); // MPEG-1, Layer III
  if (i < 0) return null;
  const br = BITRATES[c[i + 2] >> 4], rate = RATES[(c[i + 2] >> 2) & 3];
  if (!br || !rate) return null;
  const frame = Buffer.alloc(Math.floor((144 * br * 1000) / rate));
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = c[i + 2] & 0xfc; frame[3] = c[i + 3]; // без CRC, без padding
  return { frame, ms: (1152 / rate) * 1000 };
}

/** Склейка mp3: заголовки ID3 у кусков (кроме первого) убираются; между кусками — ровно gapMs тишины. */
export function joinMp3(chunks: Buffer[], gapMs = 0) {
  const sil = gapMs > 0 && chunks.length ? silentFrame(stripId3(chunks[0])) : null;
  const gap = sil ? Buffer.concat(Array.from({ length: Math.round(gapMs / sil.ms) }, () => sil.frame)) : Buffer.alloc(0);
  return Buffer.concat(chunks.flatMap((c, i) => (i === 0 ? [c] : [gap, stripId3(c)])));
}

/** Заглушка для разработки: тихий WAV нужной длины. */
export function mockWav(seconds: number) {
  const rate = 8000, n = Math.max(1, Math.round(seconds * rate)), h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + n * 2, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, Buffer.alloc(n * 2)]);
}
