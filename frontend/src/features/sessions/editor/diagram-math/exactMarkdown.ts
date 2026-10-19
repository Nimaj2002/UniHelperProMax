/**
 * Import/export rules that keep diagram and math source exact (research R2, R3).
 *
 * Every custom node is exported as an mdast `uhRaw` node whose value is written unchanged.
 * Ordinary text is exported as before, except that a `$` gets a backslash when leaving it bare
 * would turn the text into a formula the next time the note is opened.
 */
import type { LexicalExportVisitor, MdastImportVisitor } from "@mdxeditor/editor";
import type { ElementNode, LexicalNode } from "lexical";
import type * as Mdast from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Handle, Options as ToMarkdownExtension, State } from "mdast-util-to-markdown";
import { scanInline } from "./mathScanner";
import {
  compose,
  type DisplayMathMdast,
  type FenceData,
  fencedRaw,
  type InlineMathMdast,
  uhMathFromMarkdown,
  uhMathSyntax,
} from "./micromarkMath";
import { $createDiagramNode, $isDiagramNode, type DiagramNode } from "./nodes/DiagramNode";
import {
  $createInlineMathNode,
  $createMathBlockNode,
  $isInlineMathNode,
  $isInlineMathSourceNode,
  $isMathBlockNode,
  type MathBlockNode,
} from "./nodes/MathNodes";
import type { SourceBlock } from "./nodes/sourceBlock";

// Lexical text format bits (same values as lexical's TextNode formats)
const IS_BOLD = 1;
const IS_ITALIC = 2;
const IS_STRIKETHROUGH = 4;

/** The fence's first info word, lower-cased: "mermaid", "math" or something else. */
export function fenceKind(lang: string | null | undefined): "mermaid" | "math" | null {
  const word = (lang ?? "").split(/\s/)[0].toLowerCase();
  return word === "mermaid" || word === "math" ? word : null;
}

// ---------------------------------------------------------------- import

type AnyVisitor = MdastImportVisitor<Mdast.Nodes>;

const appendTo = (parent: LexicalNode, node: LexicalNode) => (parent as ElementNode).append(node);

const inlineMathVisitor: AnyVisitor = {
  testNode: "inlineMath",
  priority: 100,
  visitNode({ mdastNode, lexicalParent, actions }) {
    const node = mdastNode as unknown as InlineMathMdast;
    const math = $createInlineMathNode(node.raw);
    math.setFormat(actions.getParentFormatting());
    appendTo(lexicalParent, math);
  },
};

const displayMathVisitor: AnyVisitor = {
  testNode: "displayMath",
  priority: 100,
  visitNode({ mdastNode, lexicalParent }) {
    const node = mdastNode as unknown as DisplayMathMdast;
    appendTo(lexicalParent, $createMathBlockNode({ raw: node.raw, parts: node.parts, text: node.value }, node.form));
  },
};

type FencedCode = Mdast.Code & { data?: FenceData };

const fencedVisitor: AnyVisitor = {
  testNode: (node) => node.type === "code" && fenceKind((node as Mdast.Code).lang) !== null && fencedRaw(node as FencedCode) !== null,
  priority: 100,
  visitNode({ mdastNode, lexicalParent }) {
    const node = mdastNode as FencedCode;
    const exact = fencedRaw(node)!;
    const block = { raw: exact.raw, parts: exact.parts, text: node.value };
    const info = [node.lang, node.meta].filter(Boolean).join(" ");
    appendTo(lexicalParent, fenceKind(node.lang) === "mermaid" ? $createDiagramNode(block, info) : $createMathBlockNode(block, "fence"));
  },
};

export const importVisitors = [inlineMathVisitor, displayMathVisitor, fencedVisitor];

// ---------------------------------------------------------------- export

interface UhRaw {
  type: "uhRaw";
  value: string;
}

type Parent = Mdast.Parent;
type AnyExportVisitor = LexicalExportVisitor<LexicalNode, Mdast.Nodes>;

const FORMATS: Array<{ bit: number; type: "strong" | "emphasis" | "delete" }> = [
  { bit: IS_ITALIC, type: "emphasis" },
  { bit: IS_BOLD, type: "strong" },
  { bit: IS_STRIKETHROUGH, type: "delete" },
];

/**
 * Appends an inline `uhRaw`, inside the same emphasis/strong/delete containers MDXEditor's text
 * export would use, continuing open ones so neighbouring formatted text joins up.
 */
function appendInlineRaw(
  mdastParent: Parent,
  value: string,
  format: number,
  appendToParent: (parent: Parent, node: Mdast.RootContent) => unknown,
) {
  let parent = mdastParent;
  let continued = 0;
  for (;;) {
    const last = parent.children.at(-1);
    const f = last && FORMATS.find((c) => format & c.bit && !(continued & c.bit) && last.type === c.type);
    if (!f) break;
    continued |= f.bit;
    parent = last as Parent;
  }
  for (const f of FORMATS) {
    if (format & f.bit && !(continued & f.bit)) parent = appendToParent(parent, { type: f.type, children: [] }) as Parent;
  }
  appendToParent(parent, { type: "uhRaw", value } as unknown as Mdast.RootContent);
}

/**
 * A fenced block's Markdown for saving. An unclosed fence gets its closing fence, so anything
 * written after it later (a paragraph, a transcript) doesn't end up inside the diagram.
 */
export function savedBlockMarkdown(block: SourceBlock): string {
  const fence = /^[ \t]*(`{3,}|~{3,})/.exec(block.parts.head);
  if (!fence || block.parts.tail !== "") return block.raw;
  const indent = /^[ \t]*/.exec(block.parts.head)![0];
  return compose({ ...block.parts, tail: "\n" + indent + fence[1] });
}

export const exportVisitors: AnyExportVisitor[] = [
  {
    testLexicalNode: (n): n is LexicalNode => $isDiagramNode(n) || $isMathBlockNode(n),
    priority: 100,
    visitLexicalNode({ lexicalNode, mdastParent, actions }) {
      const block = (lexicalNode as DiagramNode | MathBlockNode).getBlock();
      actions.appendToParent(mdastParent, { type: "uhRaw", value: savedBlockMarkdown(block) } as unknown as Mdast.RootContent);
    },
  },
  {
    testLexicalNode: (n): n is LexicalNode => $isInlineMathNode(n) || $isInlineMathSourceNode(n),
    priority: 100,
    visitLexicalNode({ lexicalNode, mdastParent, actions }) {
      const raw = lexicalNode.getTextContent();
      const format = $isInlineMathNode(lexicalNode) ? lexicalNode.getFormat() : (lexicalNode as unknown as { getFormat(): number }).getFormat();
      appendInlineRaw(mdastParent, raw, format, (parent, node) => actions.appendToParent(parent, node));
    },
  },
];

// ---------------------------------------------------------------- to-markdown

/** Stand-in for a `$` that came from ordinary text, resolved by the root handler. */
const TEXT_DOLLAR = "";

const uhRawHandler = ((node: UhRaw) => node.value) as unknown as Handle;
// Tables keep their parsed mdast, so formulas inside cells reach the writer as parsed nodes.
const parsedMathHandler = ((node: { raw: string }) => node.raw) as unknown as Handle;

const textHandler: Handle = (node, _parent, state: State, info) =>
  state.safe((node as Mdast.Text).value, info).replace(/\$/g, TEXT_DOLLAR);

const rootHandler: Handle = (node, _parent, state: State, info) => {
  const out = state.containerFlow(node as Mdast.Root, info);
  return out.includes(TEXT_DOLLAR) ? resolveTextDollars(out) : out;
};

/** True when a `$` at `i` is already escaped (preceded by an odd number of backslashes). */
function escapedAt(text: string, i: number): boolean {
  let n = 0;
  while (text[i - 1 - n] === "\\") n++;
  return n % 2 === 1;
}

/**
 * Replaces the stand-ins with `$`, adding a backslash to any of them that would otherwise open
 * or close a formula. Uses the real parser to confirm, so code spans and links are respected.
 */
export function resolveTextDollars(out: string): string {
  let text = out;
  const marks = new Set<number>();
  for (let i = 0; i < text.length; i++) if (text[i] === TEXT_DOLLAR) marks.add(i);
  for (let guard = 0; guard <= marks.size; guard++) {
    const plain = text.replaceAll(TEXT_DOLLAR, "$");
    // cheap check first; the parser only runs when a text dollar could be a delimiter
    const suspicious = scanInline(plain, { markdown: true }).some((s) => delimiters(s.start, s.end, s.size).some((d) => marks.has(d)));
    const offenders = suspicious ? markedDelimiters(plain, marks) : [];
    if (offenders.length === 0) return plain;
    // escape them (`$` → `\\$`), right to left so earlier offsets stay valid
    for (const at of [...offenders].sort((a, b) => b - a)) text = text.slice(0, at) + "\\$" + text.slice(at + 1);
    const shifted = [...marks]
      .filter((m) => !offenders.includes(m))
      .map((m) => m + offenders.filter((o) => o < m).length);
    marks.clear();
    shifted.forEach((m) => marks.add(m));
  }
  return text.replaceAll(TEXT_DOLLAR, "$");
}

const delimiters = (start: number, end: number, size: number) =>
  [...Array(size).keys()].flatMap((k) => [start + k, end - 1 - k]);

/** The text dollars that delimit the first formula the parser would see, if any. */
function markedDelimiters(plain: string, marks: Set<number>): number[] {
  const tree = fromMarkdown(plain, { extensions: [uhMathSyntax], mdastExtensions: [uhMathFromMarkdown()] });
  let found: number[] = [];
  const visit = (node: Mdast.Nodes) => {
    if (found.length) return;
    if ((node.type as string) === "inlineMath" && node.position) {
      const start = node.position.start.offset!;
      const end = node.position.end.offset!;
      const size = plain.startsWith("$$", start) ? 2 : 1;
      found = delimiters(start, end, size).filter((d) => marks.has(d) && !escapedAt(plain, d));
    }
    if ("children" in node) (node.children as Mdast.Nodes[]).forEach(visit);
  };
  visit(tree);
  return found;
}

export const toMarkdownExtension: ToMarkdownExtension = {
  handlers: {
    uhRaw: uhRawHandler,
    inlineMath: parsedMathHandler,
    displayMath: parsedMathHandler,
    text: textHandler,
    root: rootHandler,
  } as ToMarkdownExtension["handlers"],
};
