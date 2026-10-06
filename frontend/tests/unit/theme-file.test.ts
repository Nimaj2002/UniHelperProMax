import { describe, expect, it } from "vitest";
import { BUILT_IN, keyColorsOf, resolve } from "@/features/settings/themes/colors";
import { fileName, parseFile, toFile, type ThemeData } from "@/features/settings/themes/themeFile";

const key = { background: "#0b1020", surface: "#141a2e", text: "#e6e9f2", accent: "#7aa2ff" };
const theme: ThemeData = { name: "Sabancı Night", base: "dark", keyColors: key, overrides: { "now-line": "#ff00aa" }, colors: resolve("dark", key, { "now-line": "#ff00aa" }) };

describe("theme files", () => {
  it("round-trips a theme exactly", () => {
    const text = toFile(theme);
    expect(text).toContain('"format": "unihelper-theme"');
    const parsed = parseFile(text);
    expect(parsed).toEqual({ ok: true, theme, filled: 0, ignored: 0 });
    expect(fileName("Sabancı Night")).toBe("Sabancı Night.uhtheme.json");
    expect(fileName('a/b:c*"')).toBe("a_b_c__.uhtheme.json");
  });

  it("fills missing colours from the base and ignores unknown ones", () => {
    const data = JSON.parse(toFile(theme));
    delete data.colors["grid-line"];
    delete data.colors["success"];
    data.colors.glow = "#ffffff";
    data.extra = { anything: true };
    const parsed = parseFile(JSON.stringify(data));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.filled).toBe(2);
    expect(parsed.ignored).toBe(1);
    expect(parsed.theme.colors["grid-line"]).toBe(BUILT_IN.dark["grid-line"]);
    expect(parsed.theme.colors).not.toHaveProperty("glow");
  });

  it("derives key colours from the colours when the file has none", () => {
    const data = JSON.parse(toFile({ ...theme, name: "Plain" }));
    delete data.keyColors;
    const parsed = parseFile(JSON.stringify(data));
    expect(parsed.ok && parsed.theme.keyColors).toEqual(keyColorsOf(theme.colors));
  });

  it.each([
    ["not json", "{nope", /valid JSON/],
    ["another format", JSON.stringify({ format: "vscode-theme", base: "dark", name: "x" }), /isn't a UniHelperProMax theme/],
    ["bad base", JSON.stringify({ format: "unihelper-theme", base: "neon", name: "x" }), /base must be light or dark/],
    ["no name", JSON.stringify({ format: "unihelper-theme", base: "dark", name: " " }), /no name/],
    ["script value", JSON.stringify({ format: "unihelper-theme", base: "dark", name: "x", colors: { accent: "<script>alert(1)</script>" } }), /not a valid colour/],
    ["css injection", JSON.stringify({ format: "unihelper-theme", base: "dark", name: "x", colors: { accent: "red; background: url(x)" } }), /not a valid colour/],
  ])("rejects %s", (_label, text, error) => {
    const parsed = parseFile(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(error);
  });

  it("rejects files over 100 KB", () => {
    const parsed = parseFile("{}", 100 * 1024 + 1);
    expect(parsed).toEqual({ ok: false, error: expect.stringMatching(/too large/) });
  });
});
