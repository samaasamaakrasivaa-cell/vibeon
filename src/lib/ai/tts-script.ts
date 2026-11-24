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

/** Склейка mp3: у всех кусков, кроме первого, убирается заголовок ID3, кадры идут подряд. */
export function joinMp3(chunks: Buffer[]) {
  return Buffer.concat(chunks.map((c, i) => {
    if (i === 0 || c.subarray(0, 3).toString() !== "ID3") return c;
    const size = ((c[6] & 0x7f) << 21) | ((c[7] & 0x7f) << 14) | ((c[8] & 0x7f) << 7) | (c[9] & 0x7f);
    return c.subarray(10 + size);
  }));
}

/** Заглушка для разработки: тихий WAV нужной длины. */
export function mockWav(seconds: number) {
  const rate = 8000, n = Math.max(1, Math.round(seconds * rate)), h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + n * 2, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, Buffer.alloc(n * 2)]);
}
