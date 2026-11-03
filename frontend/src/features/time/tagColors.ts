/**
 * Tag colours (020 FR-040) reuse the class palette, whose tokens are checked for AA contrast in
 * light and dark (lib/palette.ts): `tag-N` is the N-th palette colour. A tag may instead hold a
 * custom `#rrggbb` from the colour picker.
 */
import type { CSSProperties } from "react";
import { COLOR_KEYS, COLOR_LABELS, eventStyle, swatchStyle, type ColorKey } from "@/lib/palette";

export const TAG_COLORS = COLOR_KEYS.map((_, i) => `tag-${i + 1}`) as readonly string[];

export const isHex = (color: string | null | undefined): color is string => /^#[0-9a-f]{6}$/i.test(color ?? "");

function key(color: string | null | undefined): ColorKey | null {
  const n = Number(color?.replace("tag-", ""));
  return COLOR_KEYS[n - 1] ?? null;
}

export const colorLabel = (color: string) => (isHex(color) ? `Custom ${color}` : COLOR_LABELS[key(color) ?? "slate"]);
/** A dot or swatch; untagged time is neutral. */
export const tagDot = (color: string | null | undefined): CSSProperties =>
  isHex(color) ? { backgroundColor: color } : key(color) ? swatchStyle(key(color)!) : { backgroundColor: "var(--text-muted)" };
/** Block colours for the calendar lane and chart. A custom colour is tinted so theme text stays readable. */
export const tagBlock = (color: string | null | undefined): CSSProperties =>
  isHex(color)
    ? { backgroundColor: `color-mix(in srgb, ${color} 30%, var(--surface-elevated))`, borderColor: color, color: "var(--text-primary)" }
    : key(color)
      ? eventStyle(key(color)!)
      : { backgroundColor: "var(--surface-sunken)", borderColor: "var(--border)", color: "var(--text-primary)" };
