/**
 * Showing a diagram's or formula's source from outside the node (research R12): a future
 * "find in note" calls `revealSource` to show a match inside a drawn item (FR-016a) and
 * `conceal` to draw it again.
 */
import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";
import { $isInlineMathNode, $isInlineMathSourceNode } from "./nodes/MathNodes";
import { $openInlineSource } from "./transforms";

export interface SourceRange {
  start: number;
  end: number;
}

type Listener = { reveal: (range?: SourceRange) => void; conceal: () => void };
const blocks = new Map<NodeKey, Listener>();

/** Used by block views (diagrams, display formulas) to take part. */
export function listenForReveal(key: NodeKey, listener: Listener): () => void {
  blocks.set(key, listener);
  return () => {
    if (blocks.get(key) === listener) blocks.delete(key);
  };
}

/**
 * Opens the item's source, with `range` (offsets in its source text) selected. Returns the key
 * to pass to `conceal`: an inline formula is replaced by its source text, which has a new key.
 */
export function revealSource(editor: LexicalEditor, key: NodeKey, range?: SourceRange): NodeKey {
  const block = blocks.get(key);
  if (block) {
    block.reveal(range);
    return key;
  }
  let shown = key;
  editor.update(
    () => {
      const node = $getNodeByKey(key);
      if (!$isInlineMathNode(node)) return;
      const source = $openInlineSource(node, range ? range.start : "start");
      if (range) source.select(range.start, range.end);
      shown = source.getKey();
    },
    { discrete: true },
  );
  return shown;
}

/** Draws the item again; `key` as returned by `revealSource`. */
export function conceal(editor: LexicalEditor, key: NodeKey): void {
  const block = blocks.get(key);
  if (block) {
    block.conceal();
    return;
  }
  editor.update(() => {
    const node = $getNodeByKey(key);
    if ($isInlineMathSourceNode(node)) node.selectNext(0, 0);
  });
}
