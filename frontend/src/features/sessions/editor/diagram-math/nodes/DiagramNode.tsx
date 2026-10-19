import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { JSX } from "react";
import { DiagramView } from "../DiagramView";
import { editBlock, isSourceBlock, type SourceBlock } from "./sourceBlock";

export type SerializedDiagramNode = Spread<{ block: SourceBlock; info: string }, SerializedLexicalNode>;

/** A ```mermaid fenced block. Saved exactly as `block.raw` (research R2). */
export class DiagramNode extends DecoratorNode<JSX.Element> {
  __block: SourceBlock;
  __info: string;

  static getType(): string {
    return "uh-diagram";
  }

  static clone(node: DiagramNode): DiagramNode {
    return new DiagramNode(node.__block, node.__info, node.__key);
  }

  static importJSON(json: SerializedDiagramNode): DiagramNode {
    const block = isSourceBlock(json.block) ? json.block : { raw: "", parts: { head: "", body: "", tail: "" }, text: "" };
    return $createDiagramNode(block, typeof json.info === "string" ? json.info : "mermaid");
  }

  constructor(block: SourceBlock, info: string, key?: NodeKey) {
    super(key);
    this.__block = block;
    this.__info = info;
  }

  exportJSON(): SerializedDiagramNode {
    return { ...super.exportJSON(), type: "uh-diagram", version: 1, block: this.__block, info: this.__info };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "uh-diagram-host";
    return el;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = this.getRaw();
    pre.append(code);
    return { element: pre };
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

  getSource(): string {
    return this.getLatest().__block.text;
  }

  getInfo(): string {
    return this.getLatest().__info;
  }

  setSource(text: string): void {
    if (text === this.getSource()) return;
    this.getWritable().__block = editBlock(this.getLatest().__block, text);
  }

  decorate(): JSX.Element {
    return <DiagramView nodeKey={this.__key} source={this.__block.text} info={this.__info} />;
  }
}

export function $createDiagramNode(block: SourceBlock, info: string): DiagramNode {
  return $applyNodeReplacement(new DiagramNode(block, info));
}

export function $isDiagramNode(node: LexicalNode | null | undefined): node is DiagramNode {
  return node instanceof DiagramNode;
}
