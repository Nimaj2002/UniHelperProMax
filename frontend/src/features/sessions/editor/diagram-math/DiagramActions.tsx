import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { DotsThree } from "@phosphor-icons/react";
import { $getNodeByKey, type NodeKey } from "lexical";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resetDecision, useDecision } from "./decisions";
import { DiagramViewer } from "./DiagramViewer";
import type { DiagramFlags } from "./directives";
import { useNoteId } from "./editorContext";
import { exportPng, exportSvg } from "./exportImage";
import { $isDiagramNode } from "./nodes/DiagramNode";
import { type DiagramResult, renderDiagram } from "./rendererHost";
import { exportWhite, lightVariables, useDiagramTheme } from "./themeVars";

interface Props {
  nodeKey: NodeKey;
  source: string;
  info: string;
  hash: string;
  flags: DiagramFlags;
  result: DiagramResult | null;
  allowed: boolean;
  title: string;
  onEdit: () => void;
}

/** The diagram's "Diagram actions" menu (contracts/ui-contract.md). */
export function DiagramActions({ nodeKey, source, hash, flags, result, allowed, title, onEdit }: Props) {
  const [editor] = useLexicalComposerContext();
  const noteId = useNoteId();
  const decision = useDecision(noteId, hash);
  const theme = useDiagramTheme();
  const [viewing, setViewing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const drawn = result?.kind === "drawn" ? result : null;
  const editable = editor.isEditable();

  const focusDiagram = () => requestAnimationFrame(() => trigger.current?.closest<HTMLElement>('[data-uh="diagram"]')?.focus());

  const copySource = () => {
    const raw = editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      return $isDiagramNode(node) ? node.getRaw() : source;
    });
    void navigator.clipboard?.writeText(raw).then(
      () => toast.success("Diagram source copied."),
      () => toast.error("Couldn't copy the diagram source."),
    );
  };

  // undoable with Ctrl+Z (editor history), so no confirmation
  const remove = () => editor.update(() => $getNodeByKey(nodeKey)?.remove());

  const exportLight = async () => {
    const paper = exportWhite();
    const { promise } = renderDiagram({
      source,
      themeVariables: lightVariables(),
      themeKey: "light-white",
      useOwnTheme: false,
      background: paper,
      reducedMotion: true,
    });
    const r = await promise;
    if (r.kind === "drawn") exportSvg(r.svg, paper, title);
    else toast.error("Couldn't draw the diagram for export.");
  };

  const run = (fn: () => void | Promise<void>) => () => {
    void Promise.resolve(fn()).catch(() => toast.error("Couldn't save the image."));
  };

  return (
    <div data-uh-actions="" className="uh-diagram-actions" contentEditable={false}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="ghost" size="icon" className="size-7" data-uh="diagram-actions" aria-label="Diagram actions">
            <DotsThree size={18} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(e) => viewing && e.preventDefault()}>
          {editable && <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>}
          <DropdownMenuItem disabled={!drawn} onSelect={() => setViewing(true)}>
            Expand
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!drawn} onSelect={run(() => {
              if (drawn) exportSvg(drawn.svg, String(theme.variables.background), title);
            })}>
            Export SVG
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!drawn || allowed}
            title={allowed ? "Diagrams shown with their own settings can only be saved as SVG." : undefined}
            onSelect={run(() => (drawn ? exportPng(drawn.svg, String(theme.variables.background), title) : undefined))}
          >
            Export PNG
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!drawn && !allowed} onSelect={run(exportLight)}>
            Export light on white
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={copySource}>Copy source</DropdownMenuItem>
          {noteId && decision && (flags.unsafe.length > 0 || flags.theme.length > 0) && (
            <DropdownMenuItem onSelect={() => resetDecision(noteId, hash)}>Reset decision</DropdownMenuItem>
          )}
          {editable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {drawn && (
        <DiagramViewer
          open={viewing}
          onOpenChange={(open) => {
            setViewing(open);
            if (!open) focusDiagram();
          }}
          svg={drawn.svg}
          title={title}
        />
      )}
    </div>
  );
}
