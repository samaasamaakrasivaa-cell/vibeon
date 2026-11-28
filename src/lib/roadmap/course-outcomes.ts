const outcomeCount = 6;
// The previous input allowed six outcome strings of up to 200 characters per unit.
const outcomeBudget = JSON.stringify(Array<string>(outcomeCount).fill("x".repeat(200))).length;
const importedOutcome = /^(Topics|Grammar|Vocabulary|Skills) — (.*)$/s;
const separator = " · ";
const ellipsis = "…";

const encodedLength = (value: string) => JSON.stringify(value).length - 2;

function excerpt(value: string, budget: number) {
  if (encodedLength(value) <= budget) return value;

  let prefix = "";
  let remaining = budget - ellipsis.length;
  for (const character of value) {
    const length = encodedLength(character);
    if (length > remaining) break;
    prefix += character;
    remaining -= length;
  }
  // Prefer a word boundary if it leaves most of the excerpt intact.
  const wordEnd = prefix.lastIndexOf(" ");
  if (wordEnd > prefix.length * 0.75 && value[prefix.length] !== " ") prefix = prefix.slice(0, wordEnd);
  return prefix.trimEnd() + ellipsis;
}

function fitEntries(entries: string[], value: string, budget: number) {
  if (encodedLength(value) <= budget) return value;

  // On very dense outlines keep readable excerpts across the unit, including the last lesson.
  const sampleSize = Math.floor(budget / (24 + separator.length));
  const sampled = entries.length > sampleSize;
  const selected = sampled
    ? Array.from({ length: sampleSize }, (_, index) => entries[Math.round(index * (entries.length - 1) / (sampleSize - 1))])
    : entries;
  let remaining = budget - separator.length * (selected.length - 1) - (sampled ? separator.length + ellipsis.length : 0);
  const byLength = selected.map((text, index) => ({ text, index, length: encodedLength(text) }))
    .sort((a, b) => a.length - b.length);
  const fitted: string[] = [];
  for (const [index, entry] of byLength.entries()) {
    const snippet = excerpt(entry.text, Math.floor(remaining / (byLength.length - index)));
    fitted[entry.index] = snippet;
    remaining -= encodedLength(snippet);
  }
  if (sampled) fitted.push(ellipsis);
  return fitted.join(separator);
}

export function courseOutcomesForRoute(outcomes: string[]): string[] {
  const original = outcomes.slice(0, outcomeCount);
  const imported = outcomes.some((outcome) => importedOutcome.test(outcome));
  if (!imported && JSON.stringify(original).length <= outcomeBudget) return original;

  const fragmentsByCategory = new Map<string, string[]>();
  for (const outcome of imported ? outcomes : original) {
    const match = importedOutcome.exec(outcome);
    const prefix = match ? `${match[1]} — ` : "";
    const fragments = fragmentsByCategory.get(prefix) ?? [];
    fragments.push(match ? match[2] : outcome);
    fragmentsByCategory.set(prefix, fragments);
  }
  const groups = [...fragmentsByCategory.entries()].map(([prefix, fragments], index) => {
    // The importer breaks each category into rows and separates lesson-level goals with a middle dot.
    const entries = prefix ? fragments.join(" ").split(/\s*·\s*/).filter(Boolean) : fragments;
    const value = entries.join(separator);
    return { prefix, entries, value, index, length: encodedLength(value) };
  });
  const result = groups.map(({ prefix }) => prefix);
  let remaining = outcomeBudget - JSON.stringify(result).length;
  // Fit smaller categories in full and redistribute their spare space to the longer ones.
  const byLength = groups.sort((a, b) => a.length - b.length);
  for (const [index, group] of byLength.entries()) {
    const value = fitEntries(group.entries, group.value, Math.floor(remaining / (byLength.length - index)));
    result[group.index] += value;
    remaining -= encodedLength(value);
  }
  return result;
}
