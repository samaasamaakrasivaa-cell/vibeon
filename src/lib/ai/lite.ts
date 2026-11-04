// Простая проверка английского текста кодом, без ИИ: частые ошибки учеников.
// Используется заглушкой ИИ (AI_PROVIDER=mock) и как быстрая проверка там, где ИИ не нужен.

export type Note = { from: string; to: string; why: string };

const SPELL: Record<string, string> = {
  becouse: "because", beacuse: "because", beautifull: "beautiful", untill: "until", wich: "which", recieve: "receive", alot: "a lot",
  freind: "friend", freinds: "friends", tommorow: "tomorrow", tomorow: "tomorrow", definately: "definitely", teh: "the", realy: "really",
  writting: "writing", begining: "beginning", wierd: "weird", beleive: "believe", goverment: "government", enviroment: "environment",
  intresting: "interesting", interessting: "interesting", lenght: "length", wether: "whether", acommodation: "accommodation", occured: "occurred",
  seperate: "separate", arguement: "argument", knowlege: "knowledge", familly: "family", happend: "happened", studing: "studying", dont: "don't", cant: "can't",
};
const THIRD: Record<string, string> = { go: "goes", do: "does", have: "has", like: "likes", want: "wants", play: "plays", live: "lives", work: "works", watch: "watches", study: "studies", think: "thinks", know: "knows", need: "needs", love: "loves", read: "reads", make: "makes", get: "gets", say: "says", come: "comes", take: "takes", try: "tries", use: "uses", speak: "speaks", write: "writes", feel: "feels", help: "helps" };
const PAST: Record<string, string> = { went: "go", saw: "see", did: "do", had: "have", made: "make", took: "take", came: "come", got: "get", wrote: "write", said: "say", bought: "buy", thought: "think", ate: "eat", knew: "know", found: "find", told: "tell" };

type Rule = { re: RegExp; to: (m: RegExpExecArray) => string | null; why: string };
const RULES: Rule[] = [
  { re: /\b(\w+)\b/g, to: (m) => { const w = m[1], low = w.toLowerCase(); const fix = SPELL[low]; return fix ? (w[0] === w[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix) : null; }, why: "Орфография" },
  { re: /(^|[^\w'’])i(?=[\s'’,.!?]|$)/g, to: (m) => m[1] + "I", why: "«I» всегда пишется с большой буквы" },
  { re: /\b(I am|I'm) agree\b/gi, to: () => "I agree", why: "agree — глагол: I agree (без am)" },
  { re: /\b(he|she|it) don['’]t\b/gi, to: (m) => `${m[1]} doesn't`, why: "he / she / it → doesn't" },
  { re: /\b(he|she|it) (go|do|have|like|want|play|live|work|watch|study|think|know|need|love|read|make|get|say|come|take|try|use|speak|write|feel|help)\b/gi, to: (m) => `${m[1]} ${THIRD[m[2].toLowerCase()]}`, why: "Present Simple: he / she / it + -s" },
  { re: /\b(didn['’]t|did not) (went|saw|did|had|made|took|came|got|wrote|said|bought|thought|ate|knew|found|told)\b/gi, to: (m) => `${m[1]} ${PAST[m[2].toLowerCase()]}`, why: "После didn’t — начальная форма глагола" },
  { re: /\b(can|could|must|should|will|would|might) to (\w+)/gi, to: (m) => `${m[1]} ${m[2]}`, why: "После модального глагола to не нужно" },
  { re: /\bmore (better|worse|easier|bigger|smaller|faster)\b/gi, to: (m) => m[1], why: "Сравнительная степень уже есть: more не нужно" },
  { re: /\bpeople is\b/gi, to: () => "people are", why: "people — множественное число: people are" },
  { re: /\b(a) ([aeiou]\w*)/gi, to: (m) => (/^(uni|use|usu|eu|one|once)/i.test(m[2]) ? null : `${m[1] === "A" ? "An" : "an"} ${m[2]}`), why: "Перед гласным звуком — an" },
  { re: /\b(an) ([b-df-hj-np-tv-z]\w*)/gi, to: (m) => (/^(hour|honest|honou?r|heir)/i.test(m[2]) ? null : `${m[1] === "An" ? "A" : "a"} ${m[2]}`), why: "Перед согласным звуком — a" },
  { re: / {2,}/g, to: () => " ", why: "Лишний пробел" },
  { re: / ([,.!?;:])/g, to: (m) => m[1], why: "Пробел перед знаком препинания не нужен" },
  { re: /(^|[.!?]\s+)([a-z])/g, to: (m) => m[1] + m[2].toUpperCase(), why: "Предложение начинается с большой буквы" },
];

export function liteCorrect(text: string): { corrected: string; notes: Note[] } {
  let s = text.replace(/\r/g, "");
  const notes: Note[] = [];
  for (const r of RULES) {
    s = s.replace(r.re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      const whole = args[0] as string;
      const to = r.to(m);
      if (to === null || to === whole) return whole;
      if (notes.length < 40 && whole.trim()) notes.push({ from: whole.trim(), to: to.trim() || "—", why: r.why });
      return to;
    });
  }
  const t = s.trimEnd();
  if (t && /[a-z0-9]$/i.test(t)) { s = t + "."; notes.push({ from: t.split(/\s+/).pop()!, to: t.split(/\s+/).pop()! + ".", why: "В конце предложения нужна точка" }); }
  return { corrected: s, notes };
}

/** Сравнение ответа с эталоном без учёта регистра, пунктуации и сокращений. */
export function sameAnswer(a: string, b: string) {
  const norm = (x: string) => x.toLowerCase().replace(/[’`]/g, "'")
    .replace(/\b(\w+)n't\b/g, "$1 not").replace(/\bcan not\b/g, "cannot").replace(/\bwo not\b/g, "will not")
    .replace(/'re\b/g, " are").replace(/'m\b/g, " am").replace(/'ve\b/g, " have").replace(/'ll\b/g, " will").replace(/'d\b/g, " would")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}
