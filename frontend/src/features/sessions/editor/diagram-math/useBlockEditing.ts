import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { $getNodeByKey, $setSelection, type NodeKey } from "lexical";
import { type RefObject, useCallback, useEffect, useState } from "react";
import type { ExitReason } from "./BlockSourceEditor";
import { listenForReveal, type SourceRange } from "./reveal";
import { openOnMount } from "./transforms";

/** Whether a diagram/display formula shows its source, and the ways in and out (FR-003, FR-005). */
export function useBlockEditing(nodeKey: NodeKey, wrapper: RefObject<HTMLElement | null>) {
  const [editor] = useLexicalComposerContext();
  const [editing, setEditing] = useState(() => openOnMount.delete(nodeKey) && editor.isEditable());
  /** A range to select in the source once it's shown (find in note). */
  const [selectRange, setSelectRange] = useState<SourceRange | undefined>();
  const [isSelected, , clearSelected] = useLexicalNodeSelection(nodeKey);


  const open = useCallback(() => {
    if (editor.isEditable()) setEditing(true);
  }, [editor]);

  const close = useCallback(
    (reason: ExitReason) => {
      setEditing(false);
      clearSelected();
      if (reason === "escape") {
        editor.update(() => $setSelection(null));
        requestAnimationFrame(() => wrapper.current?.focus());
      } else if (reason === "up" || reason === "down") {
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (!node) return;
          if (reason === "up") node.selectPrevious();
          else node.selectNext(0, 0);
        });
        editor.focus();
      }
    },
    [editor, nodeKey, clearSelected, wrapper],
  );

  useEffect(
    () =>
      listenForReveal(nodeKey, {
        reveal: (range) => {
          setSelectRange(range);
          setEditing(true);
        },
        conceal: () => setEditing(false),
      }),
    [nodeKey],
  );

  // the arrow keys select the block as a whole: that opens it too (closing clears the selection)
  const shown = editing || (isSelected && editor.isEditable());
  return { editing: shown, open, close, editable: editor.isEditable(), selectRange };
}
