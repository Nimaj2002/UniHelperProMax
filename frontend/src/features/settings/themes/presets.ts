/**
 * Built-in preset themes: well-known editor palettes, available to every account like Light
 * and Dark. Each is defined by its 4 key colours (src/styles/theme-presets.json); the rest is
 * derived like any custom theme.
 * Built-in themes must meet WCAG AA (Constitution V), so a key colour that falls short is moved
 * toward black/white just far enough to pass — the palettes that already pass keep their exact
 * values. A preset may also pin a few derived tokens (`overrides`). A preference stores a preset as `preset:<slug>`.
 */
import presetData from "@/styles/theme-presets.json";
import { BLACK, contrastIssues, derive, mix, resolve, WHITE, type Base, type ColorSet, type KeyColors } from "./colors";

interface PresetSource {
  name: string;
  base: Base;
  key: KeyColors;
  overrides: Partial<ColorSet>;
}

const SOURCES: PresetSource[] = presetData.presets.map((p) => ({
  name: p.name,
  base: p.base as Base,
  key: {
    background: p.background.toLowerCase(),
    surface: p.surface.toLowerCase(),
    text: p.text.toLowerCase(),
    accent: p.accent.toLowerCase(),
  },
  overrides: Object.fromEntries(Object.entries(("overrides" in p && p.overrides) || {}).map(([k, v]) => [k, v.toLowerCase()])),
}));

const STEP = 0.02;

/** Nudge text/accent (never the backgrounds) until the derived theme has no AA issue. */
export function meetAA(base: Base, key: KeyColors): KeyColors {
  // light themes move colours toward black, dark themes toward white
  const away = base === "light" ? BLACK : WHITE;
  let next = { ...key };
  for (let i = 0; i < 100; i++) {
    const issues = contrastIssues(derive(base, next));
    if (!issues.length) return next;
    const fgs = new Set(issues.map((x) => x.pair.fg));
    if (fgs.has("text-primary") || fgs.has("text-muted")) next = { ...next, text: mix(next.text, away, STEP) };
    // the accent as text, focus ring, or a filled button whose label must stay readable
    if (fgs.has("accent") || fgs.has("focus-ring") || fgs.has("accent-foreground")) next = { ...next, accent: mix(next.accent, away, STEP) };
  }
  return next;
}

function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface Preset {
  id: string;
  name: string;
  base: Base;
  /** The palette as published. */
  original: KeyColors;
  /** What the app uses (equal to `original` unless a colour had to be adjusted for AA). */
  keyColors: KeyColors;
  overrides: Partial<ColorSet>;
  colors: ColorSet;
}

export const PRESET_PREFIX = "preset:";

export const PRESETS: Preset[] = SOURCES.map(({ name, base, key, overrides }) => {
  const keyColors = meetAA(base, key);
  return { id: `${PRESET_PREFIX}${slug(name)}`, name, base, original: key, keyColors, overrides, colors: resolve(base, keyColors, overrides) };
});

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
