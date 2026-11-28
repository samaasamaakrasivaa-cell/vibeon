const literal = (value: string) => value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/['’]/g, "['’]");

function regularForms(word: string) {
  if (!/^[a-z]{3,}$/.test(word)) return [word];
  if (/[^aeiou]y$/.test(word)) {
    const stem = word.slice(0, -1);
    return [word, stem + "ies", stem + "ied", word + "ing"];
  }
  if (word.endsWith("e")) return [word, word + "s", word + "d", word.slice(0, -1) + "ing"];
  const plural = /(?:s|x|z|ch|sh)$/.test(word) ? "es" : "s";
  const forms = [word, word + plural, word + "ed", word + "ing"];
  const doubled = /^[^aeiou]+[aeiou][bdfglmnprst]$/.test(word);
  if (doubled) {
    const stem = word + word.at(-1);
    forms.push(stem + "ed", stem + "ing");
  }
  return forms;
}

/** Splits the example into alternating plain and highlighted text, preserving punctuation. */
export function splitWordExample(example: string, word: string): string[] {
  const [head, ...rest] = word.trim().toLowerCase().split(/\s+/u);
  if (!head) return [example];

  const first = "(?:" + regularForms(head).map(literal).join("|") + ")";
  const phrase = [first, ...rest.map(literal)].join("\\s+");
  const boundary = "[\\p{L}\\p{M}\\p{N}]";
  return example.split(new RegExp("(?<!" + boundary + ")(" + phrase + ")(?!" + boundary + ")", "giu"));
}
