import katex from "katex";
import { describe, expect, it } from "vitest";
import { buildCommands, isDefiner, NO_COMMANDS, renderMath } from "@/features/sessions/editor/diagram-math/katexLoader";

describe("commands shared by formulas in a note (FR-011a)", () => {
  const formulas: Array<[string, string]> = [
    ["a", "x \\in \\RR"],
    ["b", "\\newcommand{\\RR}{\\mathbb{R}}"],
    ["c", "y \\in \\RR"],
    ["d", "\\def\\d{\\mathrm{d}}"],
    ["e", "\\int f \\d x"],
  ];

  it("recognises definers", () => {
    expect(isDefiner("\\newcommand{\\RR}{x}")).toBe(true);
    expect(isDefiner("\\gdef\\a{b}")).toBe(true);
    expect(isDefiner("\\deferred")).toBe(false);
    expect(isDefiner("x^2")).toBe(false);
  });

  it("makes a command available to later formulas only", () => {
    const table = buildCommands(katex, formulas);
    expect(renderMath(katex, "x \\in \\RR", false, table.get("a")!).kind).toBe("error");
    expect(renderMath(katex, "y \\in \\RR", false, table.get("c")!).kind).toBe("drawn");
    expect(renderMath(katex, "\\int f \\d x", false, table.get("e")!).kind).toBe("drawn");
  });

  it("changes the hash only for formulas after an edited definer", () => {
    const before = buildCommands(katex, formulas);
    const edited = buildCommands(
      katex,
      formulas.map(([k, l]) => [k, k === "d" ? "\\def\\d{\\,\\mathrm{d}}" : l] as [string, string]),
    );
    expect(edited.get("a")!.hash).toBe(before.get("a")!.hash);
    expect(edited.get("c")!.hash).toBe(before.get("c")!.hash);
    expect(edited.get("e")!.hash).not.toBe(before.get("e")!.hash);
  });

  it("doesn't let a formula's own definitions leak into another note's table", () => {
    buildCommands(katex, formulas);
    expect(renderMath(katex, "z \\in \\RR", false, NO_COMMANDS).kind).toBe("error");
  });

  it("blocks links, URLs and images (FR-031)", () => {
    for (const src of ["\\href{https://example.invalid}{x}", "\\url{https://example.invalid}", "\\includegraphics{https://example.invalid/a.png}"]) {
      const r = renderMath(katex, src, false);
      // untrusted commands are drawn as plain red text, never as a link or image
      if (r.kind === "drawn") expect(r.html).not.toMatch(/<a |<img |href=|src=/);
      else expect(r.kind).toBe("error");
    }
  });

  it("reports empty, too large and broken formulas", () => {
    expect(renderMath(katex, "  ", true).kind).toBe("empty");
    expect(renderMath(katex, "x".repeat(50_001), true).kind).toBe("tooLarge");
    const broken = renderMath(katex, "\\frac{1}{", true);
    expect(broken.kind).toBe("error");
  });

  it("exposes MathML with the LaTeX source for screen readers (FR-038)", () => {
    const r = renderMath(katex, "a^2 + b^2", false);
    expect(r.kind === "drawn" && r.html).toMatch(/<math[\s\S]*<annotation encoding="application\/x-tex">a\^2 \+ b\^2<\/annotation>/);
  });
});
