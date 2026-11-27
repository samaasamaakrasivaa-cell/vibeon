/** Read a persisted PT-01 range without guessing an invalid selected fragment. */
export function readSavedFixRange(question: string, value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d+)-(\d+)::([\s\S]*)$/.exec(value);
  if (!match) return null;
  const words = question.match(/\S+/g) ?? [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  const span = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && end < words.length
    ? { start, end }
    : null;
  return { words, span, text: match[3] };
}

export function displaySavedFixRange(question: string, value: unknown) {
  const range = readSavedFixRange(question, value);
  if (!range) return null;
  const fragment = range.span && range.words.slice(range.span.start, range.span.end + 1).join(" ");
  return fragment ? fragment + " → " + range.text : range.text;
}
