import { describe, expect, it } from "vitest";
import { contrastIssues, contrast, derive } from "@/features/settings/themes/colors";
import { meetAA, PRESETS, presetById } from "@/features/settings/themes/presets";

describe("preset themes", () => {
  it("has the 9 light and 9 dark palettes with stable ids", () => {
    expect(PRESETS.filter((p) => p.base === "light").map((p) => p.name)).toEqual([
      "GitHub Light", "Catppuccin Latte", "One Light", "Solarized Light", "Rosé Pine Dawn", "Nord Light", "Gruvbox Light",
      "Tokyo Night Light", "Linear",
    ]);
    expect(PRESETS.filter((p) => p.base === "dark").map((p) => p.name)).toEqual([
      "Dracula", "Tokyo Night", "Catppuccin Mocha", "Nord", "Gruvbox Dark", "One Dark Pro", "Rosé Pine", "Night Owl", "Midnight Blue",
    ]);
    expect(presetById("preset:rose-pine-dawn")?.name).toBe("Rosé Pine Dawn");
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(18);
    for (const p of PRESETS) expect(p.id).toMatch(/^preset:[a-z0-9-]+$/);
  });

  it("every preset meets WCAG AA (Constitution V)", () => {
    for (const p of PRESETS) expect(contrastIssues(p.colors), p.name).toEqual([]);
  });

  it("keeps palettes that already pass exactly, and never changes the backgrounds", () => {
    for (const name of ["GitHub Light", "Dracula", "Tokyo Night", "Nord", "Night Owl"]) {
      const p = PRESETS.find((x) => x.name === name)!;
      expect(p.keyColors, name).toEqual(p.original);
    }
    for (const p of PRESETS) {
      expect(p.keyColors.background).toBe(p.original.background);
      expect(p.keyColors.surface).toBe(p.original.surface);
    }
  });

  it("only nudges a failing colour as little as needed", () => {
    const one = PRESETS.find((p) => p.name === "One Light")!;
    expect(one.keyColors.text).toBe(one.original.text);
    expect(one.keyColors.accent).not.toBe(one.original.accent);
    const before = contrast(one.original.accent, one.original.background);
    const after = contrast(one.keyColors.accent, one.keyColors.background);
    expect(after).toBeGreaterThanOrEqual(4.5);
    expect(after - before).toBeLessThan(1.5); // a darker shade of the same blue, not black
  });

  it("meetAA returns a passing set for an arbitrary low-contrast palette", () => {
    const key = meetAA("light", { background: "#ffffff", surface: "#f4f4f4", text: "#999999", accent: "#ffcc00" });
    expect(contrastIssues(derive("light", key))).toEqual([]);
  });
});
