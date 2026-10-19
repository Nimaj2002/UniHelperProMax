import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";
import type { JSX } from "react";
import type { DisplayForm } from "../micromarkMath";
import { InlineMathView, MathBlockView } from "../MathView";
import { editBlock, isSourceBlock, type SourceBlock } from "./sourceBlock";

function codeDOM(raw: string, block: boolean): DOMExportOutput {
  const code = document.createElement("code");
  code.textContent = raw;
  if (!block) return { element: code };
  const pre = document.createElement("pre");
  pre.append(code);
  return { element: pre };
}

// ---------------------------------------------------------------- display math

export type SerializedMathBlockNode = Spread<{ block: SourceBlock; form: DisplayForm }, SerializedLexicalNode>;

/** `$$…$$` (several lines or one line) or a ```math fence. Saved exactly as `block.raw`. */
export class MathBlockNode extends DecoratorNode<JSX.Element> {
  __block: SourceBlock;
  __form: DisplayForm;

  static getType(): string {
    return "uh-math-block";
  }

  static clone(node: MathBlockNode): MathBlockNode {
    return new MathBlockNode(node.__block, node.__form, node.__key);
  }

  static importJSON(json: SerializedMathBlockNode): MathBlockNode {
    const block = isSourceBlock(json.block) ? json.block : { raw: "$$$$", parts: { head: "$$", body: "", tail: "$$" }, text: "" };
    return $createMathBlockNode(block, json.form ?? "dollar-multiline");
  }

  constructor(block: SourceBlock, form: DisplayForm, key?: NodeKey) {
    super(key);
    this.__block = block;
    this.__form = form;
  }

  exportJSON(): SerializedMathBlockNode {
    return { ...super.exportJSON(), type: "uh-math-block", version: 1, block: this.__block, form: this.__form };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "uh-math-block-host";
    return el;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    return codeDOM(this.getRaw(), true);
  }

  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  getTextContent(): string {
    return this.getRaw();
  }

  getRaw(): string {
    return this.getLatest().__block.raw;
  }

  getBlock(): SourceBlock {
    return this.getLatest().__block;
  }

  getLatex(): string {
    return this.getLatest().__block.text;
  }

  getForm(): DisplayForm {
    return this.getLatest().__form;
  }

  setLatex(text: string): void {
    if (text === this.getLatex()) return;
    this.getWritable().__block = editBlock(this.getLatest().__block, text);
  }

  decorate(): JSX.Element {
    return <MathBlockView nodeKey={this.__key} latex={this.__block.text} />;
  }
}

export function $createMathBlockNode(block: SourceBlock, form: DisplayForm): MathBlockNode {
  return $applyNodeReplacement(new MathBlockNode(block, form));
}

export function $isMathBlockNode(node: LexicalNode | null | undefined): node is MathBlockNode {
  return node instanceof MathBlockNode;
}

/** An empty `$$` block, as inserted by typing `$$` + Enter. */
export function $createEmptyMathBlockNode(): MathBlockNode {
  return $createMathBlockNode({ raw: "$$\n$$", parts: { head: "$$\n", body: "", tail: "\n$$" }, text: "" }, "dollar-multiline");
}

// ---------------------------------------------------------------- inline math (drawn)

export type SerializedInlineMathNode = Spread<{ raw: string; format: number }, SerializedLexicalNode>;

/** `$…$` (or `$$…$$` inside a line), drawn. Saved exactly as `raw`, delimiters included. */
export class InlineMathNode extends DecoratorNode<JSX.Element> {
  __raw: string;
  /** Bold/italic/strikethrough around the formula, kept so saving doesn't drop it. */
  __format = 0;

  static getType(): string {
    return "uh-math-inline";
  }

  static clone(node: InlineMathNode): InlineMathNode {
    const clone = new InlineMathNode(node.__raw, node.__key);
    clone.__format = node.__format;
    return clone;
  }

  static importJSON(json: SerializedInlineMathNode): InlineMathNode {
    const node = $createInlineMathNode(typeof json.raw === "string" ? json.raw : "$$");
    node.__format = typeof json.format === "number" ? json.format : 0;
    return node;
  }

  constructor(raw: string, key?: NodeKey) {
    super(key);
    this.__raw = raw;
  }

  exportJSON(): SerializedInlineMathNode {
    return { ...super.exportJSON(), type: "uh-math-inline", version: 1, raw: this.__raw, format: this.__format };
  }

  getFormat(): number {
    return this.getLatest().__format;
  }

  setFormat(format: number): void {
    if (format !== this.getFormat()) this.getWritable().__format = format;
  }

  createDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "uh-math-inline-host";
    return el;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    return codeDOM(this.getRaw(), false);
  }

  isInline(): true {
    return true;
  }

  getTextContent(): string {
    return this.getRaw();
  }

  getRaw(): string {
    return this.getLatest().__raw;
  }

  decorate(): JSX.Element {
    return <InlineMathView nodeKey={this.__key} raw={this.__raw} />;
  }
}

export function $createInlineMathNode(raw: string): InlineMathNode {
  return $applyNodeReplacement(new InlineMathNode(raw));
}

export function $isInlineMathNode(node: LexicalNode | null | undefined): node is InlineMathNode {
  return node instanceof InlineMathNode;
}

/** The LaTeX inside an inline formula's delimiters. */
export function inlineLatex(raw: string): { latex: string; display: boolean } {
  const size = raw.startsWith("$$") && raw.endsWith("$$") && raw.length >= 4 ? 2 : 1;
  return { latex: raw.slice(size, raw.length - size), display: size === 2 };
}

// ---------------------------------------------------------------- inline math (source being edited)

/**
 * The text form of an inline formula while the caret is inside it (research R4). It is an
 * ordinary editable text node, but it is saved exactly as its text.
 */
export class InlineMathSourceNode extends TextNode {
  static getType(): string {
    return "uh-math-source";
  }

  static clone(node: InlineMathSourceNode): InlineMathSourceNode {
    return new InlineMathSourceNode(node.__text, node.__key);
  }

  static importJSON(json: SerializedTextNode): InlineMathSourceNode {
    return $createInlineMathSourceNode(json.text);
  }

  exportJSON(): SerializedTextNode {
    return { ...super.exportJSON(), type: "uh-math-source", version: 1 };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const el = super.createDOM(config);
    el.classList.add("uh-math-source");
    el.dataset.uh = "math-source";
    el.spellcheck = false;
    return el;
  }

  exportDOM(): DOMExportOutput {
    return codeDOM(this.getTextContent(), false);
  }
}

export function $createInlineMathSourceNode(text: string): InlineMathSourceNode {
  return $applyNodeReplacement(new InlineMathSourceNode(text));
}

export function $isInlineMathSourceNode(node: LexicalNode | null | undefined): node is InlineMathSourceNode {
  return node instanceof InlineMathSourceNode;
}
