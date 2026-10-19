import { describe, expect, it } from "vitest";
import {
  hasDiagramOrMathFence,
  hasMath,
  isDisplayLine,
  scanInline,
} from "@/features/sessions/editor/diagram-math/mathScanner";

const raws = (text: string, markdown = true) => scanInline(text, { markdown }).map((s) => s.raw);

describe("inline math recognition (contracts/markdown-syntax.md)", () => {
  it.each([
    ["$E = mc^2$", ["$E = mc^2$"]],
    ["it costs $5 and $10", []],
    ["$5", []],
    ["a lone $ here", []],
    ["$ x$", []],
    ["$x $", []],
    ["$x$5", []],
    ["`$x$`", []],
    ["\\$x\\$", []],
    ["$a_1 * b_2$", ["$a_1 * b_2$"]],
    ["$x$, $y$", ["$x$", "$y$"]],
    ["it costs $5 and $10, a lone $ and `$x$` code.", []],
    ["$a `b$` c$", ["$a `b$` c$"]],
  ])("%s", (input, expected) => {
    expect(raws(input)).toEqual(expected);
  });

  it("allows a soft line break but not a paragraph break", () => {
    expect(raws("$a +\nb$")).toEqual(["$a +\nb$"]);
    expect(raws("$a +\n\nb$")).toEqual([]);
  });

  it("takes the first valid closing dollar, without backtracking", () => {
    expect(raws("$x$5$")).toEqual(["$x$5$"]);
    expect(raws("$a $b$")).toEqual(["$a $b$"]);
  });

  it("does not close on an escaped dollar inside the formula", () => {
    expect(raws("$a\\$b$")).toEqual(["$a\\$b$"]);
  });

  it("recognises $$…$$ inside text as one formula", () => {
    const [span] = scanInline("area is $$\\pi r^2$$ here", { markdown: true });
    expect(span).toMatchObject({ raw: "$$\\pi r^2$$", size: 2 });
  });

  it("skips code spans with longer fences", () => {
    expect(raws("``a $x$ b`` and $y$")).toEqual(["$y$"]);
  });

  it("treats backslashes literally for editor text", () => {
    expect(raws("\\$x\\$", false)).toEqual(["$x\\$"]);
    expect(raws("\\$x$", false)).toEqual(["$x$"]);
  });

  it("never matches inside skipped ranges", () => {
    expect(scanInline("$x$ and $y$", { skip: [[0, 3]] }).map((s) => s.raw)).toEqual(["$y$"]);
    expect(scanInline("$x and y$", { skip: [[3, 5]] })).toEqual([]);
  });

  it("reports offsets", () => {
    expect(scanInline("ab $x$ cd")[0]).toMatchObject({ start: 3, end: 6 });
  });
});

describe("display lines", () => {
  it.each([
    ["$$x^2$$", true],
    ["  $$x^2$$  ", true],
    ["$$$$", true],
    ["$$", false],
    ["$$ x", false],
    ["$$a$$ and $$b$$", false],
  ])("%s → %s", (line, expected) => {
    expect(isDisplayLine(line)).toBe(expected);
  });
});

describe("cheap note tests", () => {
  it("finds fences", () => {
    expect(hasDiagramOrMathFence("text\n```mermaid\nflowchart LR\n```")).toBe(true);
    expect(hasDiagramOrMathFence("~~~ Mermaid title\nx\n~~~")).toBe(true);
    expect(hasDiagramOrMathFence("- ```math\n  x\n  ```")).toBe(true);
    expect(hasDiagramOrMathFence("```js\nmermaid\n```")).toBe(false);
  });

  it("finds math", () => {
    expect(hasMath("no dollars")).toBe(false);
    expect(hasMath("it costs $5 and $10")).toBe(false);
    expect(hasMath("energy $E=mc^2$")).toBe(true);
    expect(hasMath("$$\nx\n$$")).toBe(true);
    expect(hasMath("`$x$`")).toBe(false);
  });
});
