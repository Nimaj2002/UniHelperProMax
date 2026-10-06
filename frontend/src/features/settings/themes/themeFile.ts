/**
 * Theme files (005 FR-020/FR-021, research C6): one human-readable JSON file per theme.
 * Import validates everything and never executes anything — values are only ever used as
 * `#rrggbb` strings.
 */
import { BUILT_IN, HEX, KEY_COLORS, keyColorsOf, TOKENS, type Base, type ColorSet, type KeyColors, type Token } from "./colors";

export const FORMAT = "unihelper-theme";
export const VERSION = 1;
export const MAX_BYTES = 100 * 1024;

export interface ThemeData {
  name: string;
  base: Base;
  keyColors: KeyColors;
  overrides: Partial<ColorSet>;
  colors: ColorSet;
}

export function fileName(name: string): string {
  const cleaned = Array.from(name, (ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? "_" : ch)).join("");
  const safe = cleaned.trim() || "theme";
  return `${safe}.uhtheme.json`;
}

export function toFile(t: ThemeData): string {
  return `${JSON.stringify({ format: FORMAT, version: VERSION, name: t.name, base: t.base, keyColors: t.keyColors, overrides: t.overrides, colors: t.colors }, null, 2)}\n`;
}

export type ParseResult = { ok: true; theme: ThemeData; filled: number; ignored: number } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asColor = (v: unknown): string | null => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : null);

export function parseFile(text: string, size = new Blob([text]).size): ParseResult {
  if (size > MAX_BYTES) return { ok: false, error: "This file is too large to be a theme (over 100 KB)." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't a theme file (it isn't valid JSON)." };
  }
  if (!isObject(data) || data.format !== FORMAT) return { ok: false, error: "This file isn't a UniHelperProMax theme." };
  const base = data.base;
  if (base !== "light" && base !== "dark") return { ok: false, error: "The theme's base must be light or dark." };
  const name = typeof data.name === "string" ? data.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (!name) return { ok: false, error: "The theme has no name." };
  const builtIn = BUILT_IN[base];
  let ignored = 0;
  let filled = 0;

  const readSet = (raw: unknown, keys: readonly string[], what: string): Record<string, string> | string => {
    if (raw === undefined) return {};
    if (!isObject(raw)) return `The theme's ${what} are not a list of colours.`;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!keys.includes(k)) {
        ignored++;
        continue;
      }
      const c = asColor(v);
      if (!c) return `“${k}” is not a valid colour (use #rrggbb).`;
      out[k] = c;
    }
    return out;
  };

  const colors = readSet(data.colors, TOKENS, "colours");
  if (typeof colors === "string") return { ok: false, error: colors };
  const overrides = readSet(data.overrides, TOKENS, "overrides");
  if (typeof overrides === "string") return { ok: false, error: overrides };
  const keyRaw = readSet(data.keyColors, KEY_COLORS, "key colours");
  if (typeof keyRaw === "string") return { ok: false, error: keyRaw };

  const full = {} as ColorSet;
  for (const t of TOKENS) {
    if (colors[t]) full[t] = colors[t];
    else {
      full[t] = builtIn[t];
      filled++;
    }
  }
  const fromColors = keyColorsOf(full);
  const keyColors = Object.fromEntries(KEY_COLORS.map((k) => [k, keyRaw[k] ?? fromColors[k]])) as KeyColors;
  return { ok: true, theme: { name, base, keyColors, overrides: overrides as Partial<Record<Token, string>>, colors: full }, filled, ignored };
}
