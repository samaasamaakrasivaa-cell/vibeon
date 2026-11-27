export type FixSpan = [start: number, end: number];

export function parseFixAnswer(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:-(\d+))?::([\s\S]+)$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  return { span: [start, end] as FixSpan, text: match[3].trim(), legacy: match[2] === undefined };
}

export const fixWords = (sentence: string) => sentence.match(/\S+/g) ?? [];

const leading = /^[("“\[‘]+/;
const trailing = /[.,!?;:…"”)\]’]+$/;

export function fixFragment(words: string[], [start, end]: FixSpan) {
  return words.slice(start, end + 1).join(" ").replace(leading, "").replace(trailing, "");
}

export function replaceFixFragment(words: string[], [start, end]: FixSpan, text: string) {
  const prefix = words.slice(0, start).join(" ");
  const suffix = words.slice(end + 1).join(" ");
  const before = words[start].match(leading)?.[0] ?? "";
  const after = words[end].match(trailing)?.[0] ?? "";
  const contracted = !before && /[a-z]$/i.test(prefix) && /^['’](?:s|m|d|re|ve|ll)(?:\s|$)/i.test(text);
  const replacement = (text.startsWith(before) ? "" : before) + text + (text.endsWith(after) ? "" : after);
  return prefix + (prefix && !contracted ? " " : "") + replacement + (suffix ? " " + suffix : "");
}
