// The separator keeps multiple values readable for existing consumers of Word.translation.
// Punctuation inside a legacy translation is part of that value.
const separator = ";\n";

export function wordTranslations(translation: string | null): string[] {
  return translation?.split(separator).map((value) => value.trim()).filter(Boolean) ?? [];
}

export function appendWordTranslation(translation: string | null, value: string): string {
  return [...wordTranslations(translation), value].join(separator);
}
