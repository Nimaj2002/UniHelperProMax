/**
 * Editing behaviour for math (research R4, R5):
 * - typed `$…$` becomes a formula once the caret moves on (so `$x$5` never flickers into one);
 * - the arrow keys and clicks open an inline formula as text, and leaving it draws it again;
 * - a paragraph that is only `$$…$$` becomes a display formula; `$$` + Enter opens an empty one.
 */
import { mergeRegister } from "@lexical/utils";
import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_LEFT_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  TextNode,
} from "lexical";
import { isDisplayLine, scanInline } from "./mathScanner";
import {
  $createEmptyMathBlockNode,
  $createInlineMathNode,
  $createInlineMathSourceNode,
  $createMathBlockNode,
  $isInlineMathNode,
  $isInlineMathSourceNode,
  type InlineMathNode,
  inlineLatex,
  type InlineMathSourceNode,
} from "./nodes/MathNodes";

const HISTORY_MERGE = "history-merge";
const CLOSE_TAG = "uh-math-close";

/** Blocks that should open for editing as soon as they are shown (typed `$$` + Enter, inserted). */
export const openOnMount = new Set<NodeKey>();

// ---------------------------------------------------------------- inline formula ⇄ source text

/** Shows an inline formula as editable text with the caret inside it. */
export function $openInlineSource(node: InlineMathNode, caret: "start" | "end" | number): InlineMathSourceNode {
  const raw = node.getRaw();
  const size = inlineLatex(raw).display ? 2 : 1;
  const source = $createInlineMathSourceNode(raw);
  source.setFormat(node.getFormat());
  node.replace(source);
  const offset = caret === "start" ? size : caret === "end" ? raw.length - size : Math.max(0, Math.min(raw.length, caret));
  source.select(offset, offset);
  $addUpdateTag(HISTORY_MERGE);
  return source;
}

/** Splits text into plain text and formulas, keeping its formatting. */
function $splitIntoMath(text: string, format: number): LexicalNode[] {
  const parts: LexicalNode[] = [];
  let at = 0;
  for (const span of scanInline(text)) {
    if (span.start > at) parts.push($createTextNode(text.slice(at, span.start)).setFormat(format));
    const math = $createInlineMathNode(span.raw);
    math.setFormat(format);
    parts.push(math);
    at = span.end;
  }
  if (at < text.length) parts.push($createTextNode(text.slice(at)).setFormat(format));
  return parts;
}

function $replaceWith(node: LexicalNode, parts: LexicalNode[]) {
  if (parts.length === 0) {
    node.remove();
    return;
  }
  node.replace(parts[0]);
  let prev = parts[0];
  for (const p of parts.slice(1)) {
    prev.insertAfter(p);
    prev = p;
  }
}

/** Draws an inline formula again once the caret has left it; text that's no longer math stays text. */
function $closeInlineSource(source: InlineMathSourceNode) {
  $replaceWith(source, $splitIntoMath(source.getTextContent(), source.getFormat()));
  $addUpdateTag(HISTORY_MERGE);
}

/**
 * The caret as the browser has it. Lexical's own copy can trail one key press behind when keys
 * come fast (it catches up on `selectionchange`), and then the arrow would jump over a formula.
 */
function $domCaret(): { node: LexicalNode; offset: number } | null {
  const dom = typeof window === "undefined" ? null : window.getSelection();
  if (!dom || !dom.isCollapsed || !dom.anchorNode) return null;
  const node = $getNearestNodeFromDOMNode(dom.anchorNode);
  if (!$isTextNode(node) || dom.anchorNode.nodeType !== Node.TEXT_NODE) return null;
  return { node, offset: dom.anchorOffset };
}

/** The inline formula right next to a collapsed caret, in the direction of travel. */
function $adjacentInlineMath(forward: boolean): InlineMathNode | null {
  const s = $getSelection();
  if (!$isRangeSelection(s) || !s.isCollapsed()) return null;
  const caret = $domCaret() ?? (s.anchor.type === "text" ? { node: s.anchor.getNode(), offset: s.anchor.offset } : null);
  let next: LexicalNode | null = null;
  if (caret) {
    if (forward && caret.offset === caret.node.getTextContentSize()) next = caret.node.getNextSibling();
    else if (!forward && caret.offset === 0) next = caret.node.getPreviousSibling();
  } else {
    const node = s.anchor.getNode();
    if ($isElementNode(node)) next = node.getChildAtIndex(forward ? s.anchor.offset : s.anchor.offset - 1);
  }
  return $isInlineMathNode(next) ? next : null;
}

// ---------------------------------------------------------------- typing

/**
 * A formula whose closing `$` was just typed. It becomes a formula once the caret moves on, so
 * `$x$5` (a digit right after) never turns into one. Only typed closings count: text that came
 * from opening the note (e.g. an escaped `\$x\$`) never changes by itself.
 */
interface Typed {
  key: NodeKey;
  start: number;
  end: number;
  raw: string;
}

const pendingTyped = new WeakMap<LexicalEditor, Typed>();

function $noteTypedMath(node: TextNode, editor: LexicalEditor) {
  if (!node.isSimpleText() || node.hasFormat("code") || !editor.isEditable()) return;
  const s = $getSelection();
  if (!$isRangeSelection(s) || !s.isCollapsed() || s.anchor.key !== node.getKey()) return;
  const text = node.getTextContent();
  if (text[s.anchor.offset - 1] !== "$") return;
  const span = scanInline(text).find((x) => x.end === s.anchor.offset);
  if (span) pendingTyped.set(editor, { key: node.getKey(), start: span.start, end: span.end, raw: span.raw });
}

function $convertTyped(typed: Typed) {
  const node = $getNodeByKey(typed.key);
  if (!$isTextNode(node) || !node.isAttached() || !node.isSimpleText()) return;
  const text = node.getTextContent();
  const span = scanInline(text).find((x) => x.start === typed.start && x.raw === typed.raw);
  if (!span) return;
  const parent = node.getParent();
  if ($isParagraphNode(parent) && parent.getChildrenSize() === 1 && span.size === 2 && text.trim() === span.raw && isDisplayLine(text)) {
    const body = span.raw.slice(2, -2);
    const block = $createMathBlockNode({ raw: span.raw, parts: { head: "$$", body, tail: "$$" }, text: body }, "dollar-oneline");
    parent.replace(block);
    if (!block.getNextSibling()) block.insertAfter($createParagraphNode());
    return;
  }
  const format = node.getFormat();
  const parts: LexicalNode[] = [];
  if (span.start > 0) parts.push($createTextNode(text.slice(0, span.start)).setFormat(format));
  const math = $createInlineMathNode(span.raw);
  math.setFormat(format);
  parts.push(math);
  const after = text.slice(span.end);
  const afterNode = after ? $createTextNode(after).setFormat(format) : null;
  if (afterNode) parts.push(afterNode);
  // keep the caret where it was, relative to the text after the formula
  const sel = $getSelection();
  const caretAfter = $isRangeSelection(sel) && sel.isCollapsed() && sel.anchor.key === node.getKey() ? sel.anchor.offset - span.end : null;
  $replaceWith(node, parts);
  if (caretAfter !== null && caretAfter >= 0) {
    if (afterNode) afterNode.select(caretAfter, caretAfter);
    else math.selectNext(0, 0);
  }
}

// ---------------------------------------------------------------- registration

export function registerMathEditing(editor: LexicalEditor): () => void {
  return mergeRegister(
    // keys typed in a diagram's or formula's source box belong to that box, not the note
    editor.registerCommand<KeyboardEvent>(
      KEY_DOWN_COMMAND,
      (event) => event.target instanceof HTMLElement && !!event.target.closest("[data-uh-block] textarea"),
      COMMAND_PRIORITY_CRITICAL,
    ),

    editor.registerNodeTransform(TextNode, (node) => $noteTypedMath(node, editor)),

    editor.registerCommand<KeyboardEvent | null>(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        if (event?.shiftKey || !editor.isEditable()) return false;
        const math = $adjacentInlineMath(true);
        if (!math) return false;
        event?.preventDefault();
        $openInlineSource(math, "start");
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),

    editor.registerCommand<KeyboardEvent | null>(
      KEY_ARROW_LEFT_COMMAND,
      (event) => {
        if (event?.shiftKey || !editor.isEditable()) return false;
        const math = $adjacentInlineMath(false);
        if (!math) return false;
        event?.preventDefault();
        $openInlineSource(math, "end");
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),

    editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        const s = $getSelection();
        if (!editor.isEditable() || !$isRangeSelection(s) || !s.isCollapsed() || event?.shiftKey) return false;
        const block = s.anchor.getNode().getTopLevelElement();
        if (!$isParagraphNode(block) || block.getTextContent().trim() !== "$$") return false;
        event?.preventDefault();
        const math = $createEmptyMathBlockNode();
        block.replace(math);
        if (!math.getNextSibling()) math.insertAfter($createParagraphNode());
        openOnMount.add(math.getKey());
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),

    // leaving an inline source, or moving on after typing a formula
    editor.registerUpdateListener(({ editorState, tags }) => {
      if (!editor.isEditable() || tags.has(CLOSE_TAG)) return;
      const typed = pendingTyped.get(editor);
      const { sources, moved } = editorState.read(() => {
        const s = $getSelection();
        const here = $isRangeSelection(s) && s.isCollapsed() ? s.anchor : null;
        // a selection that starts or ends inside a formula keeps it open
        const touched = $isRangeSelection(s) ? new Set([s.anchor.key, s.focus.key]) : new Set<NodeKey>();
        const open: NodeKey[] = [];
        for (const [key, node] of editorState._nodeMap) {
          if ($isInlineMathSourceNode(node) && !touched.has(key) && node.isAttached()) open.push(key);
        }
        return { sources: open, moved: !!typed && !(here?.key === typed.key && here.offset === typed.end) };
      });
      if (sources.length === 0 && !moved) return;
      editor.update(
        () => {
          for (const key of sources) {
            const node = $getNodeByKey(key);
            if ($isInlineMathSourceNode(node)) $closeInlineSource(node);
          }
          if (moved && typed) {
            pendingTyped.delete(editor);
            $convertTyped(typed);
          }
        },
        { tag: [CLOSE_TAG, HISTORY_MERGE] },
      );
    }),
  );
}
