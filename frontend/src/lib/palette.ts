/**
 * Class colour palette — keys and CSS variable references ONLY (Constitution V).
 * Colour values live in styles/tokens.css (`--event-<key>-bg/fg/border`), verified for
 * WCAG AA in light and dark by tests/unit/tokens.contrast.test.ts (FR-021).
 */
import type { CSSProperties } from "react";

export const COLOR_KEYS = [
  "slate", "red", "orange", "amber", "lime", "green",
  "teal", "cyan", "blue", "indigo", "violet", "pink",
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABELS: Record<ColorKey, string> = {
  slate: "Slate", red: "Red", orange: "Orange", amber: "Amber", lime: "Lime", green: "Green",
  teal: "Teal", cyan: "Cyan", blue: "Blue", indigo: "Indigo", violet: "Violet", pink: "Pink",
};

export function eventStyle(key: ColorKey): CSSProperties {
  return {
    backgroundColor: `var(--event-${key}-bg)`,
    color: `var(--event-${key}-fg)`,
    borderColor: `var(--event-${key}-border)`,
  };
}

/** Small swatch/dot using the class border colour. */
export function swatchStyle(key: ColorKey): CSSProperties {
  return { backgroundColor: `var(--event-${key}-border)` };
}
