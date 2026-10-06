/** Spoken-language choices (ISO 639-1); "auto" lets the provider detect it. */
export const LANGUAGE_CODES = [
  "en", "tr", "de", "fr", "es", "it", "pt", "nl", "ru", "uk", "pl", "sv", "el", "ar", "fa", "he", "hi", "zh", "ja", "ko",
] as const;

const names = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "language" }) : null;

export function languageName(code: string): string {
  if (code === "auto") return "Auto-detect";
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function languageOptions(current?: string): { value: string; label: string }[] {
  const codes: string[] = ["auto", ...LANGUAGE_CODES];
  if (current && !codes.includes(current)) codes.push(current);
  return codes.map((value) => ({ value, label: languageName(value) }));
}
