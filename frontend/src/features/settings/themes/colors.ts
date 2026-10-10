/**
 * Theme colours (005 research C4): the editable token set, built-in values (read from
 * tokens.css itself, so there is one source), derivation from 4 key colours, and the WCAG AA
 * checks used by the editor, saving and import. Pure functions.
 */
import tokensCss from "@/styles/tokens.css?raw";

export const TOKENS = [
  "surface", "surface-elevated", "surface-sunken", "surface-hover", "text-primary", "text-muted",
  "border", "divider", "grid-line", "accent", "accent-foreground", "now-line", "focus-ring",
  "success", "warning", "danger", "danger-foreground", "editor-surface",
] as const;
export type Token = (typeof TOKENS)[number];
export type ColorSet = Record<Token, string>;

export const KEY_COLORS = ["background", "surface", "text", "accent"] as const;
export type KeyColor = (typeof KEY_COLORS)[number];
export type KeyColors = Record<KeyColor, string>;
export type Base = "light" | "dark";

export const TOKEN_LABELS: Record<Token, string> = {
  surface: "Background",
  "surface-elevated": "Surface / card",
  "surface-sunken": "Sunken surface",
  "surface-hover": "Hover",
  "text-primary": "Primary text",
  "text-muted": "Muted text",
  border: "Border",
  divider: "Divider",
  "grid-line": "Calendar grid lines",
  accent: "Accent",
  "accent-foreground": "Text on accent",
  "now-line": "Secondary accent",
  "focus-ring": "Focus ring",
  success: "Success",
  warning: "Warning",
  danger: "Danger",
  "danger-foreground": "Text on danger",
  "editor-surface": "Editor background",
};

export const KEY_LABELS: Record<KeyColor, string> = { background: "Background", surface: "Surface", text: "Text", accent: "Accent" };
/** The token each key colour sets directly. */
export const KEY_TOKEN: Record<KeyColor, Token> = { background: "surface", surface: "surface-elevated", text: "text-primary", accent: "accent" };

// ---- colour maths ------------------------------------------------------------------------

export const HEX = /^#[0-9a-f]{6}$/i;
type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const [p, q] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex([0, 1, 2].map((i) => p[i] + (q[i] - p[i]) * t) as Rgb);
}

// the extremes for mixing; readable text on fills comes from the built-in tokens (below)
export const WHITE = rgbToHex([255, 255, 255]);
export const BLACK = rgbToHex([0, 0, 0]);

/** Move `fg` toward black or white (away from the backgrounds) until it reaches `min` against
 * every background, or as close as it gets. */
export function ensureContrast(fg: string, backgrounds: string[], min: number): string {
  const ok = (c: string) => backgrounds.every((bg) => contrast(c, bg) >= min);
  if (ok(fg)) return fg;
  const darkBg = backgrounds.reduce((s, bg) => s + luminance(bg), 0) / backgrounds.length < 0.18;
  const target = darkBg ? WHITE : BLACK;
  let best = fg;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    best = mix(fg, target, t);
    if (ok(best)) return best;
  }
  return best;
}

// ---- built-in themes (parsed from tokens.css) ------------------------------------------

function parseBlock(selector: string): ColorSet {
  const start = tokensCss.indexOf(selector);
  const open = tokensCss.indexOf("{", start);
  const body = tokensCss.slice(open + 1, tokensCss.indexOf("}", open));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1]] = m[2].toLowerCase();
  return Object.fromEntries(TOKENS.map((t) => [t, vars[t]])) as ColorSet;
}

export const BUILT_IN: Record<Base, ColorSet> = {
  light: parseBlock('[data-theme="light"]'),
  dark: parseBlock('[data-theme="dark"]'),
};

/** Near-white / near-black text from the built-in themes, whichever reads better on `bg`. */
function readable(bg: string): string {
  const light = BUILT_IN.light["accent-foreground"];
  const dark = BUILT_IN.dark["accent-foreground"];
  return contrast(light, bg) >= contrast(dark, bg) ? light : dark;
}

export function keyColorsOf(colors: ColorSet): KeyColors {
  return { background: colors.surface, surface: colors["surface-elevated"], text: colors["text-primary"], accent: colors.accent };
}

// ---- derivation -------------------------------------------------------------------------

/** Full colour set from the 4 key colours; key colours themselves are never altered (a poor
 * choice is reported by `contrastIssues`, not silently fixed). */
export function derive(base: Base, key: KeyColors): ColorSet {
  const b = BUILT_IN[base];
  const { background: bg, surface: surf, text, accent } = key;
  const darkBg = luminance(bg) < 0.18;
  const surfaces = [bg, surf];
  const danger = ensureContrast(b.danger, surfaces, 4.5);
  const sunken = darkBg ? mix(bg, BLACK, 0.3) : mix(bg, text, 0.04);
  return {
    surface: bg,
    "surface-elevated": surf,
    "surface-sunken": sunken,
    "surface-hover": mix(surf, text, 0.08),
    "text-primary": text,
    // muted text is also shown on sunken fills (e.g. a hovered toggle)
    "text-muted": ensureContrast(mix(text, bg, 0.35), [...surfaces, sunken], 4.5),
    border: ensureContrast(mix(text, bg, 0.5), [bg], 3),
    divider: mix(bg, text, 0.12),
    "grid-line": mix(bg, text, 0.09),
    accent,
    "accent-foreground": readable(accent),
    "now-line": ensureContrast(b["now-line"], [bg], 3),
    "focus-ring": ensureContrast(accent, [bg], 3),
    success: ensureContrast(b.success, surfaces, 4.5),
    warning: ensureContrast(b.warning, surfaces, 4.5),
    danger,
    "danger-foreground": readable(danger),
    "editor-surface": surf,
  };
}

export function resolve(base: Base, key: KeyColors, overrides: Partial<ColorSet>): ColorSet {
  return { ...derive(base, key), ...overrides };
}

// ---- WCAG AA checks ----------------------------------------------------------------------

export interface ContrastPair {
  fg: Token;
  bg: Token;
  min: number;
  label: string;
}

const pair = (fg: Token, bg: Token, min = 4.5, note?: string): ContrastPair => ({
  fg,
  bg,
  min,
  label: `${TOKEN_LABELS[fg]} on ${TOKEN_LABELS[bg]}${note ? ` — ${note}` : ""}`,
});

export const CONTRAST_PAIRS: ContrastPair[] = [
  pair("text-primary", "surface"),
  pair("text-primary", "surface-elevated"),
  pair("text-primary", "surface-sunken"),
  pair("text-primary", "editor-surface"),
  pair("text-muted", "surface"),
  pair("text-muted", "surface-elevated"),
  pair("text-muted", "surface-sunken"), // hovered toggles and menu items
  pair("text-primary", "surface-hover"), // selected toggles (e.g. calendar Week/Day/Month)
  pair("accent", "surface"),
  pair("accent", "surface-elevated"),
  pair("accent-foreground", "accent"),
  pair("danger", "surface"),
  pair("success", "surface"),
  pair("warning", "surface"),
  pair("danger-foreground", "danger"),
  // the cards' edge against the window background (008 FR-041)
  pair("border", "surface", 3, "card edges"),
  pair("focus-ring", "surface", 3),
];

export interface ContrastIssue {
  pair: ContrastPair;
  ratio: number;
}

export function contrastIssues(colors: ColorSet): ContrastIssue[] {
  return CONTRAST_PAIRS.map((p) => ({ pair: p, ratio: contrast(colors[p.fg], colors[p.bg]) })).filter((i) => i.ratio < i.pair.min);
}

export const formatRatio = (r: number) => `${(Math.floor(r * 10) / 10).toFixed(1)}:1`;

/** CSS custom properties for a colour set (applied to <html> or a preview container). */
export function cssVars(colors: ColorSet): Record<string, string> {
  return Object.fromEntries(TOKENS.map((t) => [`--${t}`, colors[t]]));
}
