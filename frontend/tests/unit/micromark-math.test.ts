import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";
import {
  type DisplayMathMdast,
  fencedRaw,
  type InlineMathMdast,
  uhMathFromMarkdown,
  uhMathSyntax,
} from "@/features/sessions/editor/diagram-math/micromarkMath";

type AnyNode = { type: string; children?: AnyNode[] } & Record<string, unknown>;

function parse(md: string): AnyNode {
  return fromMarkdown(md, { extensions: [uhMathSyntax], mdastExtensions: [uhMathFromMarkdown()] }) as unknown as AnyNode;
}

function all(node: AnyNode, type: string, out: AnyNode[] = []): AnyNode[] {
  if (node.type === type) out.push(node);
  node.children?.forEach((c) => all(c, type, out));
  return out;
}

const inline = (md: string) => all(parse(md), "inlineMath").map((n) => (n as unknown as InlineMathMdast).raw);
const display = (md: string) => all(parse(md), "displayMath") as unknown as DisplayMathMdast[];

describe("micromark math: text", () => {
  it.each([
    ["the energy $E = mc^2$ is", ["$E = mc^2$"]],
    ["it costs $5 and $10", []],
    ["a lone $ here", []],
    ["$ x$ and $x $", []],
    ["$x$5", []],
    ["`$x$`", []],
    ["\\$x\\$", []],
    ["$a_1 * b_2$", ["$a_1 * b_2$"]],
    ["$x$, $y$", ["$x$", "$y$"]],
    ["area is $$\\pi r^2$$ here", ["$$\\pi r^2$$"]],
    ["$a\\$b$", ["$a\\$b$"]],
    ["[link]($x$)", []],
    ["it costs $5 and $10, a lone $ and `$x$` code.", []],
    ["$a `b$` c$", ["$a `b$` c$"]],
    ["$a ``b$`` c$ d", ["$a ``b$`` c$"]],
  ])("%s", (md, expected) => {
    expect(inline(md)).toEqual(expected);
  });

  it("keeps soft line breaks inside the formula without container prefixes", () => {
    expect(inline("$a +\nb$")).toEqual(["$a +\nb$"]);
    expect(inline("> $a +\n> b$")).toEqual(["$a +\nb$"]);
  });

  it("does not let emphasis or brackets inside a formula be parsed", () => {
    const tree = parse("$a*b*c [d](e)$");
    expect(all(tree, "emphasis")).toHaveLength(0);
    expect(all(tree, "link")).toHaveLength(0);
  });
});

describe("micromark math: blocks", () => {
  it("parses a several-line block exactly", () => {
    const [node] = display("$$\n\\frac{a}{b}\n\\\\ x_1\n$$");
    expect(node).toMatchObject({ form: "dollar-multiline", raw: "$$\n\\frac{a}{b}\n\\\\ x_1\n$$", value: "\\frac{a}{b}\n\\\\ x_1" });
  });

  it("keeps blank lines and trailing spaces on the fences", () => {
    const [node] = display("$$  \na\n\nb\n$$ ");
    expect(node.raw).toBe("$$  \na\n\nb\n$$ ");
  });

  it("parses a one-line block", () => {
    const [node] = display("$$x^2$$");
    expect(node).toMatchObject({ form: "dollar-oneline", raw: "$$x^2$$", value: "x^2" });
    expect(display("$$$$")[0]).toMatchObject({ form: "dollar-oneline", raw: "$$$$", value: "" });
  });

  it("treats an unclosed block as ordinary text", () => {
    const tree = parse("$$\nx\n\n# Heading");
    expect(all(tree, "displayMath")).toHaveLength(0);
    expect(all(tree, "heading")).toHaveLength(1);
  });

  it("works inside lists and quotes", () => {
    expect(display("- item\n\n  $$\n  a\n  $$")[0].raw).toBe("$$\na\n$$");
    expect(display("> $$\n> a\n> $$")[0].raw).toBe("$$\na\n$$");
  });

  it("keeps the indentation of an indented block", () => {
    expect(display("  $$\n  a\n   b\n  $$")[0].raw).toBe("  $$\n  a\n   b\n  $$");
  });

  it("can interrupt a paragraph", () => {
    expect(display("text\n$$\nx\n$$")).toHaveLength(1);
  });
});

describe("fenced code: exact source", () => {
  const code = (md: string) =>
    fencedRaw(all(parse(md), "code")[0] as unknown as Parameters<typeof fencedRaw>[0]);

  it.each([
    "```mermaid\nflowchart LR\n  A --> B\n```",
    "~~~mermaid\nflowchart LR\n~~~",
    "````Mermaid  title here\nx\n\n y\n````",
    "```mermaid\n```",
    "```mermaid\n\n```",
    "  ```mermaid\n  a\n    b\n  ```",
    "```math\n\\frac12\n```   ",
  ])("%s", (md) => {
    expect(code(md)?.raw).toBe(md);
  });

  it("handles an unclosed fence", () => {
    expect(code("```mermaid\nflowchart LR")?.raw).toBe("```mermaid\nflowchart LR");
  });

  it("strips container prefixes", () => {
    expect(code("> ```mermaid\n> a\n> ```")?.raw).toBe("```mermaid\na\n```");
  });
});
