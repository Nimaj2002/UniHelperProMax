/**
 * Commands defined by formulas, shared with the formulas after them in the same note
 * (FR-011a). One table per editor; formulas read their entry with `useNoteCommands`.
 */
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $dfs } from "@lexical/utils";
import { $getRoot, type LexicalEditor } from "lexical";
import { useCallback, useSyncExternalStore } from "react";
import { buildCommands, isDefiner, katexIfLoaded, loadKatex, NO_COMMANDS, type NoteCommands } from "./katexLoader";
import { $isInlineMathNode, $isInlineMathSourceNode, $isMathBlockNode, inlineLatex } from "./nodes/MathNodes";

interface Table {
  byKey: Map<string, NoteCommands>;
  signature: string;
  listeners: Set<() => void>;
}

const tables = new WeakMap<LexicalEditor, Table>();

function tableOf(editor: LexicalEditor): Table {
  let t = tables.get(editor);
  if (!t) {
    t = { byKey: new Map(), signature: "", listeners: new Set() };
    tables.set(editor, t);
  }
  return t;
}

/** Formulas of the note in document order, as [node key, LaTeX]. */
function $formulas(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const { node } of $dfs($getRoot())) {
    if ($isInlineMathNode(node)) out.push([node.getKey(), inlineLatex(node.getRaw()).latex]);
    else if ($isInlineMathSourceNode(node)) out.push([node.getKey(), inlineLatex(node.getTextContent()).latex]);
    else if ($isMathBlockNode(node)) out.push([node.getKey(), node.getLatex()]);
  }
  return out;
}

function recompute(editor: LexicalEditor) {
  const table = tableOf(editor);
  const formulas = editor.getEditorState().read($formulas);
  const definers = formulas.some(([, latex]) => isDefiner(latex));
  // only formulas' places relative to definers matter, so that's the signature
  const signature = definers ? formulas.map(([key, latex]) => (isDefiner(latex) ? `${key}=${latex}` : key)).join("\u0000") : "";
  if (signature === table.signature) return;
  const k = katexIfLoaded();
  if (definers && !k) {
    void loadKatex().then(() => recompute(editor));
    return;
  }
  table.signature = signature;
  table.byKey = definers && k ? buildCommands(k, formulas) : new Map();
  table.listeners.forEach((l) => l());
}

/** Keeps the editor's command table up to date. Registered once per editor by the plugin. */
export function registerNoteCommands(editor: LexicalEditor): () => void {
  recompute(editor);
  return editor.registerUpdateListener(() => recompute(editor));
}

export function useNoteCommands(nodeKey: string): NoteCommands {
  const [editor] = useLexicalComposerContext();
  const subscribe = useCallback(
    (listener: () => void) => {
      const t = tableOf(editor);
      t.listeners.add(listener);
      return () => t.listeners.delete(listener);
    },
    [editor],
  );
  return useSyncExternalStore(subscribe, () => tableOf(editor).byKey.get(nodeKey) ?? NO_COMMANDS);
}
