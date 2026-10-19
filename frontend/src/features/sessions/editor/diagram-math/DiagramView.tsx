import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { AllowedDiagramFrame } from "./AllowedDiagramFrame";
import { BlockSourceEditor, useDebounced } from "./BlockSourceEditor";
import { diagramHash, useDecision } from "./decisions";
import { DiagramActions } from "./DiagramActions";
import { classify } from "./directives";
import { useNoteId } from "./editorContext";
import { $isDiagramNode } from "./nodes/DiagramNode";
import { rememberHeight, reservedHeight } from "./renderCache";
import { cachedDiagram, type DiagramRequest, type DiagramResult, renderDiagram } from "./rendererHost";
import { useDiagramTheme } from "./themeVars";
import { useBlockEditing } from "./useBlockEditing";
import { useNearViewport } from "./useNearViewport";
import { useReducedMotion } from "./useReducedMotion";

interface Props {
  nodeKey: NodeKey;
  source: string;
  info: string;
}

/** Draws a request in the renderer frame; results are reused while nothing changed (FR-025). */
export function useDiagram(request: DiagramRequest, wanted: boolean): DiagramResult | null {
  const [result, setResult] = useState<{ key: string; value: DiagramResult } | null>(null);
  const key = `${request.themeKey}|${request.useOwnTheme}|${request.background}|${request.reducedMotion}|${request.source}`;
  const hit = cachedDiagram(request);
  useEffect(() => {
    if (!wanted || hit) return;
    let live = true;
    const { promise, cancel } = renderDiagram(request);
    void promise.then((value) => live && setResult({ key, value }));
    return () => {
      live = false;
      cancel();
    };
    // `request` is described completely by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wanted, hit]);
  if (hit) return hit;
  return result?.key === key ? result.value : null;
}

const MESSAGES: Record<string, string> = {
  timedOut: "This diagram took longer than 5 seconds to draw and is shown as code.",
  tooLarge: "This diagram is too large to draw (over 50,000 characters) and is shown as code.",
  empty: "Empty diagram. Press Enter to edit.",
};

function DiagramMessage({ result }: { result: DiagramResult | null }) {
  if (!result || result.kind === "drawn") return null;
  const text = result.kind === "error" ? `Diagram error: ${result.message}` : MESSAGES[result.kind];
  return (
    <div className="uh-render-message whitespace-pre-wrap text-left" data-uh="render-message" role="status" data-tone={result.kind === "error" ? "error" : undefined}>
      {text}
    </div>
  );
}

/** The drawn SVG, centered and fitted to the note width; very wide diagrams keep a readable size and scroll on their own. */
function DrawnSvg({ result }: { result: Extract<DiagramResult, { kind: "drawn" }> }) {
  const style = { "--uh-min-width": `${Math.round(result.width * 0.5)}px` } as CSSProperties;
  return <div className="uh-diagram-svg" style={style} aria-hidden="true" dangerouslySetInnerHTML={{ __html: result.svg }} />;
}

export function DiagramView({ nodeKey, source, info }: Props) {
  const [editor] = useLexicalComposerContext();
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const theme = useDiagramTheme();
  const reducedMotion = useReducedMotion();
  const noteId = useNoteId();
  const { editing, open, close, editable, selectRange } = useBlockEditing(nodeKey, ref);

  const hash = diagramHash(source, info);
  const decision = useDecision(noteId, hash);
  const flags = useMemo(() => classify(source), [source]);
  const allowed = flags.unsafe.length > 0 && decision?.unsafe === "allow";
  const useOwnTheme = flags.theme.length > 0 && decision?.theme === "own";

  const preview = useDebounced(source, 400);
  const request: DiagramRequest = {
    source: editing ? preview : source,
    themeVariables: theme.variables,
    themeKey: theme.key,
    useOwnTheme,
    background: String(theme.variables.background),
    reducedMotion,
  };
  const result = useDiagram(request, (near || editing) && !allowed);

  // remember the drawn height so the next time this diagram appears nothing jumps (FR-023)
  useEffect(() => {
    if (result?.kind === "drawn" && ref.current && !editing) rememberHeight(String(hash), ref.current.getBoundingClientRect().height);
  }, [result, hash, editing]);

  const setSource = (value: string) =>
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isDiagramNode(node)) node.setSource(value);
    });

  const state = allowed ? "allowed" : result === null ? "pending" : result.kind;
  const title = flags.title ?? "Diagram";
  const descriptionId = flags.description ? `uh-diagram-desc-${nodeKey}` : undefined;

  return (
    // A focusable, labelled group: Enter (and a click) opens its source, Escape returns. It's a
    // group rather than a button because it contains its own "Diagram actions" button.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={ref}
      data-uh="diagram"
      data-uh-block=""
      data-state={state}
      className="uh-block uh-diagram"
      tabIndex={editing ? -1 : 0}
      // a labelled group, not role="img": an image role would hide the actions button inside it
      role="group"
      aria-roledescription="diagram"
      aria-label={title}
      aria-describedby={descriptionId}
      style={result === null && !allowed ? { minHeight: reservedHeight(String(hash)) } : undefined}
      onKeyDown={(e) => {
        if (!editing && e.key === "Enter" && editable && e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          open();
        }
      }}
      onClick={(e) => {
        // clicks in the actions menu (portaled, but React passes them up here) aren't edits
        const target = e.target as HTMLElement;
        if (!editing && e.currentTarget.contains(target) && !target.closest("[data-uh-actions]")) open();
      }}
    >
      {descriptionId && (
        <span id={descriptionId} className="sr-only">
          {flags.description}
        </span>
      )}
      {editing && <BlockSourceEditor readOnly={!editable} selectRange={selectRange} dataUh="diagram-source" label="Diagram source (Mermaid)" value={source} onChange={setSource} onExit={close} />}
      <div data-uh={editing ? "diagram-preview" : undefined} className="uh-diagram-body" contentEditable={false}>
        {allowed ? (
          <AllowedDiagramFrame request={request} title={title} />
        ) : result?.kind === "drawn" ? (
          <DrawnSvg result={result} />
        ) : result === null ? (
          <div className="uh-diagram-placeholder" aria-hidden="true" />
        ) : (
          !editing && (
            <pre className="uh-diagram-code">
              <code>{source}</code>
            </pre>
          )
        )}
      </div>
      <DiagramMessage result={allowed ? null : result} />
      {!editing && <DiagramActions nodeKey={nodeKey} source={source} info={info} hash={hash} flags={flags} result={result} allowed={allowed} title={title} onEdit={open} />}
    </div>
  );
}
