import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";
import { EVENT_KEYS, readThemes } from "./tokens";

const TEXT_PAIRS: [string, string][] = [
  ["text-primary", "surface"],
  ["text-primary", "surface-elevated"],
  ["text-primary", "surface-sunken"],
  ["text-primary", "surface-hover"],
  ["text-muted", "surface"],
  ["text-muted", "surface-elevated"],
  ["text-muted", "surface-sunken"],
  ["accent", "surface"],
  ["accent", "surface-elevated"],
  ["accent-foreground", "accent"],
  ["danger", "surface"],
  ["danger", "surface-elevated"],
  ["danger-foreground", "danger"],
  ["success", "surface"],
  ["warning", "surface"],
  ["reader-page-dark-fg", "reader-page-dark-bg"], // 007 dark pages
];

const UI_PAIRS: [string, string][] = [
  ["focus-ring", "surface"],
  ["focus-ring", "surface-elevated"],
  ["border", "surface"],
  ["border", "surface-elevated"],
  ["now-line", "surface"],
];

describe.each(["light", "dark"] as const)("%s theme tokens", (theme) => {
  const t = readThemes()[theme];

  it.each(TEXT_PAIRS)("%s on %s ≥ 4.5:1", (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)("%s on %s ≥ 3:1", (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });

  it.each(EVENT_KEYS)("class colour %s: fg on bg ≥ 4.5:1 (FR-021)", (key) => {
    const fg = t[`event-${key}-fg`];
    const bg = t[`event-${key}-bg`];
    expect(fg).toBeDefined();
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
