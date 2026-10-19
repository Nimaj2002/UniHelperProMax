/**
 * The one dollar-math recogniser (specs/013-note-diagrams-math/contracts/markdown-syntax.md).
 * The micromark extension implements the same rules for opened notes; this module is used for
 * typed text, the export-time `$` check and the cheap "does this note need math?" test.
 */

export interface MathSpan {
  /** Offset of the opening `$`. */
  start: number;
  /** Offset just after the closing `$`. */
  end: number;
  /** The exact source including delimiters. */
  raw: string;
  /** 1 for `$…$`, 2 for `$$…$$`. */
  size: 1 | 2;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

function runLength(text: string, at: number, ch: string): number {
  let n = 0;
  while (text[at + n] === ch) n++;
  return n;
}

/**
 * Finds every inline formula in `text`, scanning left to right without backtracking.
 * `skip` ranges (e.g. code-formatted text) are never part of a formula.
 * With `markdown: true`, backslashes escape the next character and code spans are skipped,
 * as when reading Markdown source; otherwise the text is taken literally (editor text).
 */
export function scanInline(text: string, options: { markdown?: boolean; skip?: Array<[number, number]> } = {}): MathSpan[] {
  const { markdown = false, skip = [] } = options;
  const spans: MathSpan[] = [];
  const skipAt = (i: number) => skip.find(([a, b]) => i >= a && i < b);
  let i = 0;
  while (i < text.length) {
    const skipped = skipAt(i);
    if (skipped) {
      i = skipped[1];
      continue;
    }
    const c = text[i];
    if (markdown && c === "\\") {
      i += 2;
      continue;
    }
    if (markdown && c === "`") {
      const n = runLength(text, i, "`");
      const close = findBacktickClose(text, i + n, n);
      i = close === -1 ? i + n : close + n;
      continue;
    }
    if (c !== "$") {
      i++;
      continue;
    }
    const n = runLength(text, i, "$");
    if (n > 2 || isSpace(text[i + n])) {
      i += n;
      continue;
    }
    const end = findClose(text, i + n, n as 1 | 2, markdown, skipAt);
    if (end === -1) {
      i += n;
      continue;
    }
    spans.push({ start: i, end, raw: text.slice(i, end), size: n as 1 | 2 });
    i = end;
  }
  return spans;
}

function findBacktickClose(text: string, from: number, n: number): number {
  let j = from;
  while (j < text.length) {
    if (text[j] === "`") {
      const m = runLength(text, j, "`");
      if (m === n) return j;
      j += m;
    } else j++;
  }
  return -1;
}

/** Offset just after a valid closing run, or -1. Stops at a paragraph break. */
function findClose(
  text: string,
  from: number,
  size: 1 | 2,
  markdown: boolean,
  skipAt: (i: number) => [number, number] | undefined,
): number {
  let j = from;
  while (j < text.length) {
    if (skipAt(j)) return -1;
    const c = text[j];
    if (c === "\\" && markdown) {
      j += 2;
      continue;
    }
    if (c === "\n" && /^\n[^\S\n]*\n/.test(text.slice(j))) return -1;
    if (c === "`" && markdown) {
      // a code span binds tighter than math: a `$` inside it can't close the formula
      const n = runLength(text, j, "`");
      const close = findBacktickClose(text, j + n, n);
      j = close === -1 ? j + n : close + n;
      continue;
    }
    if (c === "$") {
      const m = runLength(text, j, "$");
      if (m === size && !isSpace(text[j - 1]) && !isDigit(text[j + m])) return j + m;
      j += m;
      continue;
    }
    j++;
  }
  return -1;
}

/** A line that is a one-line display formula on its own (`$$x$$`, spaces around allowed). */
export function isDisplayLine(line: string): boolean {
  const t = line.trim();
  if (t === "$$$$") return true;
  if (!t.startsWith("$$") || !t.endsWith("$$") || t.length < 5) return false;
  const inner = t.slice(2, -2);
  return !inner.includes("$$");
}

const FENCE_RE = /^[ \t>]*(?:[-*+]\s+|\d+[.)]\s+)?(`{3,}|~{3,})[ \t]*(mermaid|math)\b/im;

/** Cheap test used before mounting the editor: could this note contain a diagram? */
export function hasDiagramOrMathFence(markdown: string): boolean {
  return FENCE_RE.test(markdown);
}

/** Cheap test used before mounting the editor: could this note contain math? */
export function hasMath(markdown: string): boolean {
  if (!markdown.includes("$")) return false;
  if (/^[ \t>]*\$\$/m.test(markdown)) return true;
  return markdown.split(/\n[^\S\n]*\n/).some((para) => scanInline(para, { markdown: true }).length > 0);
}
