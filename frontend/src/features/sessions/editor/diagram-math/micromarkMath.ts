/**
 * Markdown parsing for math and for exact fenced-block source
 * (specs/013-note-diagrams-math/contracts/markdown-syntax.md, research R2).
 *
 * - `uhMathSyntax`: micromark constructs for `$…$` / `$$…$$` in text and `$$` blocks.
 * - `uhMathFromMarkdown`: turns them into `inlineMath` / `displayMath` mdast nodes that keep the
 *   exact source (`raw`), and records the exact fence lines of fenced code so mermaid and math
 *   fences can be written back unchanged.
 */
import type { CompileContext, Extension as FromMarkdownExtension, Token as MdastToken } from "mdast-util-from-markdown";
import type { Code, Construct, Effects, Extension, State, TokenizeContext, TokenType } from "micromark-util-types";

const DOLLAR = 36;
const BACKSLASH = 92;
const BACKTICK = 96;

const isLineEnding = (code: Code) => code !== null && code < -2;
const isSpace = (code: Code) => code === -2 || code === -1 || code === 32;
const isLineEndingOrSpace = (code: Code) => code !== null && (code < 0 || code === 32);
const isDigit = (code: Code) => code !== null && code >= 48 && code <= 57;

// Our token names are not in micromark's TokenTypeMap; one cast keeps the rest readable.
const T = (name: string) => name as TokenType;

/** Like micromark-factory-space: optional run of spaces/tabs as one token, at most `max - 1`. */
function space(effects: Effects, ok: State, type: string, max = Infinity): State {
  let size = 0;
  return function start(code) {
    if (isSpace(code)) {
      effects.enter(T(type));
      return prefix(code);
    }
    return ok(code);
  };
  function prefix(code: Code): State | undefined {
    if (isSpace(code) && size++ < max - 1) {
      effects.consume(code);
      return prefix;
    }
    effects.exit(T(type));
    return ok(code);
  }
}

// ---------------------------------------------------------------- text: $…$ and $$…$$

const mathText: Construct = { name: "uhMathText", tokenize: tokenizeMathText, previous: previousMathText };

function previousMathText(this: TokenizeContext, code: Code): boolean {
  return code !== DOLLAR || this.events[this.events.length - 1][1].type === "characterEscape";
}

function tokenizeMathText(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let sizeOpen = 0;
  let prev: Code = null;
  let inData = false;
  const closing: Construct = { tokenize: tokenizeClose, partial: true };
  const codeSpan: Construct = { tokenize: tokenizeCodeSpan, partial: true };
  return start;

  function start(code: Code) {
    effects.enter(T("uhMathText"));
    effects.enter(T("uhMathTextSequence"));
    return open(code);
  }

  function open(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      sizeOpen++;
      return open;
    }
    if (sizeOpen > 2 || code === null || isLineEndingOrSpace(code)) return nok(code);
    effects.exit(T("uhMathTextSequence"));
    return data(code);
  }

  function take(code: Code) {
    if (!inData) {
      effects.enter(T("uhMathTextData"));
      inData = true;
    }
    effects.consume(code);
    prev = code;
  }

  function stopData() {
    if (inData) {
      effects.exit(T("uhMathTextData"));
      inData = false;
    }
  }

  function data(code: Code): State | undefined {
    if (code === null) return nok(code);
    if (isLineEnding(code)) {
      stopData();
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      prev = code;
      return data;
    }
    if (code === BACKSLASH) {
      take(code);
      return escaped;
    }
    if (code === DOLLAR) {
      if (prev === null || isLineEndingOrSpace(prev)) return dollarsAsData(code);
      stopData();
      return effects.attempt(closing, done, dollarsAsData)(code);
    }
    if (code === BACKTICK) {
      // a code span binds tighter than math: a `$` inside it can't close the formula
      stopData();
      return effects.attempt(codeSpan, data, backticksAsData)(code);
    }
    take(code);
    return data;
  }

  function backticksAsData(code: Code): State | undefined {
    if (code === BACKTICK) {
      take(code);
      return backticksAsData;
    }
    return data(code);
  }

  /** A whole code span (same-length backtick runs), kept as formula text. */
  function tokenizeCodeSpan(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    let sizeOpen = 0;
    let size = 0;
    return function start(code) {
      effects.enter(T("uhMathTextData"));
      return open(code);
    };
    function open(code: Code): State | undefined {
      if (code === BACKTICK) {
        effects.consume(code);
        sizeOpen++;
        return open;
      }
      return inside(code);
    }
    function inside(code: Code): State | undefined {
      if (code === null) return nok(code);
      if (isLineEnding(code)) {
        effects.exit(T("uhMathTextData"));
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        effects.enter(T("uhMathTextData"));
        return inside;
      }
      if (code === BACKTICK) {
        size = 0;
        return close(code);
      }
      effects.consume(code);
      return inside;
    }
    function close(code: Code): State | undefined {
      if (code === BACKTICK) {
        effects.consume(code);
        size++;
        return close;
      }
      if (size === sizeOpen) {
        prev = BACKTICK;
        effects.exit(T("uhMathTextData"));
        return ok(code);
      }
      return inside(code);
    }
  }

  function escaped(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) return data(code);
    take(code);
    return data;
  }

  function dollarsAsData(code: Code): State | undefined {
    if (code === DOLLAR) {
      take(code);
      return dollarsAsData;
    }
    return data(code);
  }

  function done(code: Code) {
    effects.exit(T("uhMathText"));
    return ok(code);
  }

  function tokenizeClose(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    let size = 0;
    return function start(code) {
      effects.enter(T("uhMathTextSequence"));
      return sequence(code);
    };
    function sequence(code: Code): State | undefined {
      if (code === DOLLAR) {
        effects.consume(code);
        size++;
        return sequence;
      }
      if (size !== sizeOpen || isDigit(code)) return nok(code);
      effects.exit(T("uhMathTextSequence"));
      return ok(code);
    }
  }
}

// ---------------------------------------------------------------- flow: $$ blocks

const mathFlow: Construct = { name: "uhMathFlow", tokenize: tokenizeMathFlow, concrete: true };
const nonLazyContinuation: Construct = { tokenize: tokenizeNonLazyContinuation, partial: true };

function tokenizeMathFlow(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self = this;
  const tail = self.events[self.events.length - 1];
  const initialSize = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
  let sizeOpen = 0;
  let fence: ReturnType<Effects["enter"]>;
  const closingFence: Construct = { tokenize: tokenizeClosingFence, partial: true };
  const closingOneLine: Construct = { tokenize: tokenizeClosingOneLine, partial: true };
  return start;

  function start(code: Code) {
    effects.enter(T("uhMathFlow"));
    fence = effects.enter(T("uhMathFlowFence"));
    return sequenceOpen(code);
  }

  function sequenceOpen(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      sizeOpen++;
      return sequenceOpen;
    }
    if (sizeOpen === 4) {
      // `$$$$`: an empty one-line formula
      fence.type = T("uhMathFlowOneLine");
      return space(effects, oneLineEnd, "whitespace")(code);
    }
    if (sizeOpen !== 2) return nok(code);
    return space(effects, afterOpen, "whitespace")(code);
  }

  function afterOpen(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) {
      effects.exit(T("uhMathFlowFence"));
      if (self.interrupt) return ok(code);
      return effects.attempt(nonLazyContinuation, beforeLine, nok)(code);
    }
    fence.type = T("uhMathFlowOneLine");
    return oneLine(code);
  }

  // `$$x$$` alone on its line
  function oneLine(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) return nok(code);
    if (code === BACKSLASH) {
      effects.consume(code);
      return oneLineEscaped;
    }
    if (code === DOLLAR) return effects.attempt(closingOneLine, oneLineEnd, oneLineDollars)(code);
    effects.consume(code);
    return oneLine;
  }

  function oneLineEscaped(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) return nok(code);
    effects.consume(code);
    return oneLine;
  }

  function oneLineDollars(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      return oneLineDollars;
    }
    return oneLine(code);
  }

  function oneLineEnd(code: Code): State | undefined {
    if (code !== null && !isLineEnding(code)) return nok(code);
    effects.exit(T("uhMathFlowOneLine"));
    effects.exit(T("uhMathFlow"));
    return ok(code);
  }

  function tokenizeClosingOneLine(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    let size = 0;
    return sequence;
    function sequence(code: Code): State | undefined {
      if (code === DOLLAR) {
        effects.consume(code);
        size++;
        return sequence;
      }
      if (size !== 2) return nok(code);
      return space(effects, end, "whitespace")(code);
    }
    function end(code: Code) {
      return code === null || isLineEnding(code) ? ok(code) : nok(code);
    }
  }

  // several-line form
  function beforeLine(code: Code): State | undefined {
    return effects.attempt(closingFence, after, contentStart)(code);
  }

  function contentStart(code: Code): State | undefined {
    return (initialSize ? space(effects, beforeContent, "linePrefix", initialSize + 1) : beforeContent)(code);
  }

  function beforeContent(code: Code): State | undefined {
    // Unclosed: not math at all, so the lines stay ordinary text.
    if (code === null) return nok(code);
    if (isLineEnding(code)) return effects.attempt(nonLazyContinuation, beforeLine, nok)(code);
    effects.enter(T("uhMathFlowValue"));
    return content(code);
  }

  function content(code: Code): State | undefined {
    if (code === null || isLineEnding(code)) {
      effects.exit(T("uhMathFlowValue"));
      return beforeContent(code);
    }
    effects.consume(code);
    return content;
  }

  function after(code: Code) {
    effects.exit(T("uhMathFlow"));
    return ok(code);
  }

  function tokenizeClosingFence(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    let size = 0;
    return space(effects, beforeSequence, "linePrefix", 4);
    function beforeSequence(code: Code): State | undefined {
      if (code !== DOLLAR) return nok(code);
      effects.enter(T("uhMathFlowFence"));
      effects.enter(T("uhMathFlowFenceSequence"));
      return sequence(code);
    }
    function sequence(code: Code): State | undefined {
      if (code === DOLLAR) {
        size++;
        effects.consume(code);
        return sequence;
      }
      if (size < 2) return nok(code);
      effects.exit(T("uhMathFlowFenceSequence"));
      return space(effects, afterSequence, "whitespace")(code);
    }
    function afterSequence(code: Code) {
      if (code === null || isLineEnding(code)) {
        effects.exit(T("uhMathFlowFence"));
        return ok(code);
      }
      return nok(code);
    }
  }
}

function tokenizeNonLazyContinuation(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self = this;
  return function start(code) {
    if (code === null) return ok(code);
    effects.enter("lineEnding");
    effects.consume(code);
    effects.exit("lineEnding");
    return lineStart;
  };
  function lineStart(code: Code) {
    return self.parser.lazy[self.now().line] ? nok(code) : ok(code);
  }
}

export const uhMathSyntax: Extension = {
  flow: { [DOLLAR]: mathFlow },
  text: { [DOLLAR]: mathText },
};

// ---------------------------------------------------------------- mdast

export type DisplayForm = "dollar-multiline" | "dollar-oneline" | "fence";

/** Exact source split so an edited body can be put back between the original delimiters. */
export interface RawParts {
  head: string;
  body: string;
  tail: string;
}

export interface InlineMathMdast {
  type: "inlineMath";
  raw: string;
  value: string;
  size: 1 | 2;
  position?: unknown;
}

export interface DisplayMathMdast {
  type: "displayMath";
  raw: string;
  value: string;
  form: DisplayForm;
  parts: RawParts;
  position?: unknown;
}

/** What we record on mdast `code` nodes (fenced) to write them back exactly. */
export interface FenceData {
  uhOpen?: string;
  uhOpenLine?: number;
  uhOpenIndent?: string;
  uhClose?: string;
  uhCloseLine?: number;
  uhCloseIndent?: string;
  uhPrefixes?: Record<number, string>;
}

/** Joins head + body + tail; an empty body doesn't leave a blank line between the fences. */
export function compose(parts: RawParts): string {
  const { head, body, tail } = parts;
  if (body === "" && head.endsWith("\n")) return tail.startsWith("\n") ? head + tail.slice(1) : head.slice(0, -1) + tail;
  return head + body + tail;
}

interface FlowState {
  node: DisplayMathMdast;
  open?: string;
  openLine: number;
  openIndent: string;
  close?: string;
  closeLine?: number;
  values: Map<number, string>;
  prefixes: Map<number, string>;
}

interface UhData {
  uhLastPrefix?: { end: number; text: string; line: number };
  uhFlow?: FlowState;
  uhCode?: { data: FenceData };
}

type Ctx = CompileContext & { data: CompileContext["data"] & UhData };

function indentBefore(ctx: Ctx, token: MdastToken): string {
  const p = ctx.data.uhLastPrefix;
  return p && p.end === token.start.offset ? p.text : "";
}

export function uhMathFromMarkdown(): FromMarkdownExtension {
  return {
    enter: {
      uhMathFlow(this: Ctx, token) {
        const node: DisplayMathMdast = {
          type: "displayMath",
          raw: "",
          value: "",
          form: "dollar-multiline",
          parts: { head: "", body: "", tail: "" },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.enter(node as any, token);
        this.data.uhFlow = {
          node,
          openLine: token.start.line,
          openIndent: indentBefore(this, token),
          values: new Map(),
          prefixes: new Map(),
        };
      },
      uhMathText(this: Ctx, token) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.enter({ type: "inlineMath", raw: "", value: "", size: 1 } as any, token);
      },
      codeFencedFence(this: Ctx, token) {
        const node = this.stack[this.stack.length - 1] as unknown as { type: string; data?: FenceData };
        if (node.type !== "code") return;
        const data = (node.data ??= {});
        if (data.uhOpen === undefined) {
          data.uhOpen = this.sliceSerialize(token);
          data.uhOpenLine = token.start.line;
          data.uhOpenIndent = indentBefore(this, token);
          data.uhPrefixes = {};
          this.data.uhCode = { data };
        }
      },
    },
    exit: {
      linePrefix(this: Ctx, token) {
        const text = this.sliceSerialize(token);
        this.data.uhLastPrefix = { end: token.end.offset, text, line: token.start.line };
        const flow = this.data.uhFlow;
        if (flow) flow.prefixes.set(token.start.line, text);
        const code = this.data.uhCode;
        if (code?.data.uhPrefixes && code.data.uhClose === undefined) code.data.uhPrefixes[token.start.line] = text;
      },
      codeFencedFence(this: Ctx, token) {
        // The opening fence is handled on enter; mdast's own handler keeps running through
        // `codeFencedFenceInfo`/`Meta` — we only need to notice the closing fence here.
        const code = this.data.uhCode;
        if (code && code.data.uhOpenLine !== token.start.line && code.data.uhClose === undefined) {
          code.data.uhClose = this.sliceSerialize(token);
          code.data.uhCloseLine = token.start.line;
          code.data.uhCloseIndent = indentBefore(this, token);
          this.data.uhCode = undefined;
        }
        // Mirror mdast-util-from-markdown's own handler (overridden by this key).
        if (this.data.flowCodeInside) return;
        this.buffer();
        this.data.flowCodeInside = true;
      },
      uhMathFlowFence(this: Ctx, token) {
        const flow = this.data.uhFlow;
        if (!flow) return;
        if (flow.open === undefined) flow.open = this.sliceSerialize(token);
        else {
          flow.close = this.sliceSerialize(token);
          flow.closeLine = token.start.line;
        }
      },
      uhMathFlowOneLine(this: Ctx, token) {
        const flow = this.data.uhFlow;
        if (!flow) return;
        const line = this.sliceSerialize(token);
        const m = /^(\$\$)([\s\S]*?)(\$\$[ \t]*)$/.exec(line);
        flow.node.form = "dollar-oneline";
        flow.node.parts = m
          ? { head: flow.openIndent + m[1], body: m[2], tail: m[3] }
          : { head: flow.openIndent + line, body: "", tail: "" };
        flow.open = line;
      },
      uhMathFlowValue(this: Ctx, token) {
        this.data.uhFlow?.values.set(token.start.line, this.sliceSerialize(token));
      },
      uhMathFlow(this: Ctx, token) {
        const flow = this.data.uhFlow;
        this.data.uhFlow = undefined;
        if (!flow) return;
        const { node } = flow;
        if (node.form === "dollar-multiline") {
          const closeLine = flow.closeLine ?? token.end.line + 1;
          const raw: string[] = [];
          const value: string[] = [];
          for (let line = flow.openLine + 1; line < closeLine; line++) {
            const v = flow.values.get(line) ?? "";
            value.push(v);
            raw.push((flow.prefixes.get(line) ?? "") + v);
          }
          const openLine = flow.openIndent + (flow.open ?? "$$");
          const closeText = (flow.prefixes.get(closeLine) ?? "") + (flow.close ?? "$$");
          node.parts = { head: openLine + "\n", body: raw.join("\n"), tail: "\n" + closeText };
          node.raw = [openLine, ...raw, closeText].join("\n");
          node.value = value.join("\n");
        } else {
          node.value = node.parts.body;
          node.raw = node.parts.head + node.parts.body + node.parts.tail;
        }
        this.exit(token);
      },
      uhMathText(this: Ctx, token) {
        const node = this.stack[this.stack.length - 1] as unknown as InlineMathMdast;
        node.raw = this.sliceSerialize(token);
        node.size = node.raw.startsWith("$$") ? 2 : 1;
        node.value = node.raw.slice(node.size, -node.size);
        this.exit(token);
      },
    },
  };
}

/** Exact source of a fenced code block, from the data recorded while parsing. */
export function fencedRaw(node: {
  value: string;
  data?: FenceData;
  position?: { end: { line: number } };
}): { raw: string; parts: RawParts } | null {
  const d = node.data;
  if (!d?.uhOpen || d.uhOpenLine === undefined) return null;
  const open = (d.uhOpenIndent ?? "") + d.uhOpen;
  const lastContentLine = d.uhCloseLine !== undefined ? d.uhCloseLine - 1 : (node.position?.end.line ?? d.uhOpenLine);
  const count = lastContentLine - d.uhOpenLine;
  const valueLines = count === 0 ? [] : node.value.split("\n");
  const lines =
    valueLines.length === count ? valueLines.map((v, i) => (d.uhPrefixes?.[d.uhOpenLine! + 1 + i] ?? "") + v) : valueLines;
  const close = d.uhClose !== undefined ? (d.uhCloseIndent ?? "") + d.uhClose : null;
  const raw = [open, ...lines, ...(close === null ? [] : [close])].join("\n");
  return { raw, parts: { head: open + "\n", body: lines.join("\n"), tail: close === null ? "" : "\n" + close } };
}
