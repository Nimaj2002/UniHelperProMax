import { describe, expect, it } from "vitest";
import {
  BUILT_IN, contrast, contrastIssues, derive, ensureContrast, KEY_COLORS, keyColorsOf, resolve, TOKENS, type KeyColors,
} from "@/features/settings/themes/colors";
import { readThemes } from "./tokens";

describe("theme colours", () => {
  it("built-in themes come from tokens.css and pass every check", () => {
    const css = readThemes();
    for (const base of ["light", "dark"] as const) {
      for (const t of TOKENS) expect(BUILT_IN[base][t], `${base} ${t}`).toBe(css[base][t].toLowerCase());
      expect(contrastIssues(BUILT_IN[base])).toEqual([]);
    }
  });

  it.each<[string, "light" | "dark", KeyColors]>([
    ["paper", "light", { background: "#fbf7ef", surface: "#ffffff", text: "#2b2118", accent: "#9a3412" }],
    ["night", "dark", { background: "#0b1020", surface: "#141a2e", text: "#e6e9f2", accent: "#7aa2ff" }],
    ["mint", "light", { background: "#f1faf5", surface: "#ffffff", text: "#13261c", accent: "#1d7a4c" }],
    ["plum", "dark", { background: "#1c1222", surface: "#271a30", text: "#f3e9f7", accent: "#d39cf0" }],
  ])("derives an AA-compliant set from sensible key colours (%s)", (_name, base, key) => {
    const colors = derive(base, key);
    expect(Object.keys(colors).sort()).toEqual([...TOKENS].sort());
    expect(colors.surface).toBe(key.background); // key colours are kept as chosen
    expect(colors.accent).toBe(key.accent);
    expect(contrastIssues(colors)).toEqual([]);
  });

  it("overrides win over derived colours", () => {
    const key = keyColorsOf(BUILT_IN.dark);
    const colors = resolve("dark", key, { "now-line": "#123456" });
    expect(colors["now-line"]).toBe("#123456");
    expect(colors.surface).toBe(BUILT_IN.dark.surface);
  });

  it("flags failing pairs with their ratio", () => {
    const colors = resolve("light", { background: "#ffffff", surface: "#ffffff", text: "#222222", accent: "#ffd400" }, {});
    const issues = contrastIssues(colors);
    const accent = issues.find((i) => i.pair.fg === "accent" && i.pair.bg === "surface");
    expect(accent?.pair.label).toBe("Accent on Background");
    expect(accent?.ratio).toBeCloseTo(contrast("#ffd400", "#ffffff"), 5);
    expect(accent!.ratio).toBeLessThan(4.5);
  });

  it("ensureContrast moves away from the background until it reaches the minimum", () => {
    const fixed = ensureContrast("#999999", ["#ffffff"], 4.5);
    expect(contrast(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(ensureContrast("#000000", ["#ffffff"], 4.5)).toBe("#000000");
  });

  it("warns when the card edges vanish into the window background, without new colours (008 FR-039–FR-041)", () => {
    // the layout reuses Background, Surface / card and Border: the editable colour set is unchanged
    expect(TOKENS).toHaveLength(18);
    expect(KEY_COLORS).toEqual(["background", "surface", "text", "accent"]);
    for (const b of ["light", "dark"] as const) expect(contrastIssues(BUILT_IN[b])).toEqual([]);
    const faint = { ...BUILT_IN.light, surface: "#f8f8f9", border: "#f0f0f0" };
    const edge = contrastIssues(faint).find((i) => i.pair.fg === "border" && i.pair.bg === "surface");
    expect(edge?.pair.label).toBe("Border on Background — card edges");
    expect(edge?.pair.min).toBe(3);
  });
});
