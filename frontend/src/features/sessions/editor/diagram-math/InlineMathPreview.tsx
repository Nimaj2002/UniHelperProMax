import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH, KEY_ESCAPE_COMMAND, type NodeKey } from "lexical";
import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useDebounced } from "./BlockSourceEditor";
import { MathMessage, MathResultView, useMath } from "./MathView";
import { $isInlineMathSourceNode, inlineLatex } from "./nodes/MathNodes";
import { useNoteCommands } from "./noteCommands";

/**
 * While the caret is inside an inline formula's source, its drawn result floats just under the
 * line (clarification Q3). Escape leaves the formula, after its closing `$`.
 */
export function InlineMathPreview() {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState<{ key: NodeKey; text: string } | null>(null);

  useEffect(() => {
    const read = () =>
      editor.getEditorState().read(() => {
        const s = $getSelection();
        const node = $isRangeSelection(s) && s.isCollapsed() ? s.anchor.getNode() : null;
        setActive($isInlineMathSourceNode(node) ? { key: node.getKey(), text: node.getTextContent() } : null);
      });
    read();
    return editor.registerUpdateListener(read);
  }, [editor]);

  useEffect(
    () =>
      editor.registerCommand<KeyboardEvent | null>(
        KEY_ESCAPE_COMMAND,
        (event) => {
          const s = $getSelection();
          const node = $isRangeSelection(s) ? s.anchor.getNode() : null;
          if (!$isInlineMathSourceNode(node)) return false;
          event?.preventDefault();
          node.selectNext(0, 0);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );

  const text = useDebounced(active?.text ?? "", 400, active?.key);
  const { latex, display } = inlineLatex(text);
  const commands = useNoteCommands(active?.key ?? "");
  const result = useMath(latex, display, commands, !!active);
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => (active ? editor.getElementByKey(active.key)?.getBoundingClientRect() : undefined) ?? new DOMRect(),
      },
    }),
    [active, editor],
  );

  if (!active) return null;
  return (
    <Popover open modal={false}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        data-uh="math-preview"
        side="bottom"
        align="start"
        avoidCollisions
        className="w-auto max-w-[min(32rem,90vw)] px-3 py-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        aria-label="Formula preview"
      >
        <MathResultView result={result} source={text} />
        <MathMessage result={result} />
      </PopoverContent>
    </Popover>
  );
}
