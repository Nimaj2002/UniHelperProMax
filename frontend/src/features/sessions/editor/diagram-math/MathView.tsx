import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";
import { type MouseEvent, useEffect, useRef, useSyncExternalStore } from "react";
import { BlockSourceEditor, useDebounced } from "./BlockSourceEditor";
import { katexIfLoaded, loadKatex, MAX_SOURCE, type MathResult, type NoteCommands, onKatexLoaded, renderMath } from "./katexLoader";
import { $isInlineMathNode, $isMathBlockNode, inlineLatex } from "./nodes/MathNodes";
import { useNoteCommands } from "./noteCommands";
import { $openInlineSource } from "./transforms";
import { useBlockEditing } from "./useBlockEditing";
import { useNearViewport } from "./useNearViewport";

/** KaTeX once loaded; starts loading it when `wanted` (FR-027). */
export function useKatex(wanted: boolean) {
  const k = useSyncExternalStore(onKatexLoaded, katexIfLoaded);
  useEffect(() => {
    if (wanted && !k) void loadKatex();
  }, [wanted, k]);
  return k;
}

export function useMath(latex: string, display: boolean, commands: NoteCommands, wanted: boolean): MathResult | null {
  const k = useKatex(wanted);
  if (latex.length > MAX_SOURCE) return { kind: "tooLarge" };
  return k && wanted ? renderMath(k, latex, display, commands) : null;
}

const stateOf = (r: MathResult | null) => (r === null ? "pending" : r.kind);

export function MathResultView({ result, source }: { result: MathResult | null; source: string }) {
  if (result?.kind === "drawn") return <span dangerouslySetInnerHTML={{ __html: result.html }} />;
  return <code className={result?.kind === "error" ? "uh-math-error" : undefined}>{source}</code>;
}

export function MathMessage({ result }: { result: MathResult | null }) {
  if (!result || result.kind === "drawn") return null;
  const text =
    result.kind === "error"
      ? `Formula error: ${result.message}`
      : result.kind === "tooLarge"
        ? "This formula is too large to draw (over 50,000 characters) and is shown as code."
        : "Empty formula. Press Enter to edit.";
  return (
    <div className="uh-render-message" data-uh="render-message" role="status" data-tone={result.kind === "error" ? "error" : undefined}>
      {text}
    </div>
  );
}

// ---------------------------------------------------------------- display math

export function MathBlockView({ nodeKey, latex }: { nodeKey: NodeKey; latex: string }) {
  const [editor] = useLexicalComposerContext();
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const commands = useNoteCommands(nodeKey);
  const { editing, open, close, editable, selectRange } = useBlockEditing(nodeKey, ref);
  const preview = useDebounced(latex, 400);
  const result = useMath(editing ? preview : latex, true, commands, near || editing);

  const setLatex = (value: string) =>
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isMathBlockNode(node)) node.setLatex(value);
    });

  return (
    // A focusable, labelled group: Enter (and a click) opens its LaTeX source, Escape returns.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={ref}
      data-uh="math-block"
      data-uh-block=""
      data-state={stateOf(result)}
      className="uh-block"
      tabIndex={editing ? -1 : 0}
      role="group"
      aria-roledescription="formula"
      aria-label="Formula"
      onKeyDown={(e) => {
        if (!editing && e.key === "Enter" && editable) {
          e.preventDefault();
          e.stopPropagation();
          open();
        }
      }}
      onClick={(e) => !editing && e.currentTarget.contains(e.target as Node) && open()}
    >
      {editing && <BlockSourceEditor readOnly={!editable} selectRange={selectRange} dataUh="math-source" label="Formula source (LaTeX)" value={latex} onChange={setLatex} onExit={close} />}
      <div className="flex justify-center text-center" contentEditable={false}>
        {result?.kind === "drawn" ? <MathResultView result={result} source={latex} /> : !editing && <pre className="whitespace-pre-wrap"><MathResultView result={result} source={latex} /></pre>}
      </div>
      <MathMessage result={result} />
    </div>
  );
}

// ---------------------------------------------------------------- inline math

export function InlineMathView({ nodeKey, raw }: { nodeKey: NodeKey; raw: string }) {
  const [editor] = useLexicalComposerContext();
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(ref);
  const commands = useNoteCommands(nodeKey);
  const { latex, display } = inlineLatex(raw);
  const result = useMath(latex, display, commands, near);

  const openSource = (e: MouseEvent) => {
    if (!editor.isEditable()) return;
    e.preventDefault();
    const box = ref.current?.getBoundingClientRect();
    const caret: "start" | "end" = box && e.clientX < box.left + box.width / 2 ? "start" : "end";
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isInlineMathNode(node)) $openInlineSource(node, caret);
    });
    editor.focus();
  };

  return (
    // keyboard users reach the source with the arrow keys (transforms.ts); this is the pointer way in
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span ref={ref} data-uh="math-inline" data-state={stateOf(result)} className="uh-math-inline" onMouseDown={openSource}>
      <MathResultView result={result} source={raw} />
      {result?.kind === "error" && <span className="sr-only">Formula error: {result.message}</span>}
    </span>
  );
}
