/**
 * Tag colours (020 FR-040) reuse the class palette, whose tokens are checked for AA contrast in
 * light and dark (lib/palette.ts): `tag-N` is the N-th palette colour.
 */
import type { CSSProperties } from "react";
import { COLOR_KEYS, COLOR_LABELS, eventStyle, swatchStyle, type ColorKey } from "@/lib/palette";

export const TAG_COLORS = COLOR_KEYS.map((_, i) => `tag-${i + 1}`) as readonly string[];

function key(color: string | null | undefined): ColorKey | null {
  const n = Number(color?.replace("tag-", ""));
  return COLOR_KEYS[n - 1] ?? null;
}

export const colorLabel = (color: string) => COLOR_LABELS[key(color) ?? "slate"];
/** A dot or swatch; untagged time is neutral. */
export const tagDot = (color: string | null | undefined): CSSProperties =>
  key(color) ? swatchStyle(key(color)!) : { backgroundColor: "var(--text-muted)" };
/** Block colours for the calendar lane and chart. */
export const tagBlock = (color: string | null | undefined): CSSProperties =>
  key(color) ? eventStyle(key(color)!) : { backgroundColor: "var(--surface-sunken)", borderColor: "var(--border)", color: "var(--text-primary)" };
