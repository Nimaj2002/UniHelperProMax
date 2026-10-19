/**
 * KaTeX, loaded only when a note shows a formula (FR-027), and the per-note table of commands
 * defined by formulas (FR-011a, research R7).
 */
import type KatexType from "katex";
import { LruCache } from "./renderCache";

type Katex = typeof KatexType;

/** Longer sources are shown as code instead of being drawn (FR-022). */
export const MAX_SOURCE = 50_000;

let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;
const loadedListeners = new Set<() => void>();

export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([m]) => {
    katex = m.default;
    loadedListeners.forEach((l) => l());
    return katex;
  });
  return loading;
}

export const katexIfLoaded = () => katex;

export function onKatexLoaded(listener: () => void): () => void {
  loadedListeners.add(listener);
  return () => loadedListeners.delete(listener);
}

export type Macros = Record<string, string>;

export type MathResult =
  | { kind: "drawn"; html: string }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "tooLarge" };

const cache = new LruCache<string, MathResult>(300);

function options(displayMode: boolean, macros: Macros) {
  return {
    displayMode,
    output: "htmlAndMathml" as const,
    throwOnError: true,
    // no \href, \url, \includegraphics, \html… (FR-031)
    trust: false,
    strict: "ignore" as const,
    maxSize: 50,
    maxExpand: 1000,
    globalGroup: true,
    macros,
  };
}

function errorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/^KaTeX parse error:\s*/, "");
}

/** Draws one formula; results are reused while the source and the commands before it are unchanged. */
export function renderMath(k: Katex, latex: string, displayMode: boolean, commands: NoteCommands = NO_COMMANDS): MathResult {
  if (latex.length > MAX_SOURCE) return { kind: "tooLarge" };
  if (latex.trim() === "") return { kind: "empty" };
  const key = `${displayMode ? "D" : "I"}|${commands.hash}|${latex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let result: MathResult;
  try {
    // a copy, so a formula's own \newcommand doesn't leak into the shared table
    result = { kind: "drawn", html: k.renderToString(latex, options(displayMode, { ...commands.macros })) };
  } catch (e) {
    result = { kind: "error", message: errorMessage(e) };
  }
  cache.set(key, result);
  return result;
}

// ---------------------------------------------------------------- shared commands

export interface NoteCommands {
  macros: Macros;
  /** Changes whenever the commands available to a formula change. */
  hash: string;
}

export const NO_COMMANDS: NoteCommands = { macros: {}, hash: "0" };

const DEFINER = /\\(?:re)?newcommand|\\providecommand|\\g?def\b|\\let\b/;

export const isDefiner = (latex: string) => DEFINER.test(latex);

/**
 * Builds the commands each formula may use: those defined by earlier formulas in the note,
 * in document order. `formulas` are [key, latex] pairs in document order.
 */
export function buildCommands(k: Katex, formulas: Array<[string, string]>): Map<string, NoteCommands> {
  const out = new Map<string, NoteCommands>();
  const macros: Macros = {};
  let current = NO_COMMANDS;
  let hash = "";
  for (const [key, latex] of formulas) {
    out.set(key, current);
    if (!isDefiner(latex)) continue;
    try {
      k.renderToString(latex, options(false, macros));
    } catch {
      // a broken definition defines nothing
    }
    hash += `\u0000${latex}`;
    current = { macros: { ...macros }, hash: String(hashString(hash)) };
  }
  return out;
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
