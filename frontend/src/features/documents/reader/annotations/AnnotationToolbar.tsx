/** Annotation tools, colour, undo/redo and save state (007 FR-025–FR-029, FR-032; ui-reader.md). */
import { ArrowArcLeft, ArrowArcRight, CaretDown, CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ColorMenuItems } from "./AnnotationItem";
import { saveLabel, type SaveStatus } from "./saveState";
import { NO_TEXT_DOCUMENT, NO_TEXT_PAGE, TOOLS, type Tool } from "./tools";
import { colorOf, type ColorId } from "./types";

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  /** A text selection exists in this reader. */
  canHighlight: boolean;
  onHighlight: () => void;
  /** null while unknown */
  documentHasText: boolean | null;
  pageHasText: boolean | null;
  color: ColorId;
  onColor: (c: ColorId) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  status: SaveStatus;
  disabled: boolean;
}

export function AnnotationToolbar(p: Props) {
  const color = colorOf(p.color);
  const noText = p.documentHasText === false ? NO_TEXT_DOCUMENT : p.pageHasText === false ? NO_TEXT_PAGE : null;
  const StatusIcon = p.status === "saved" ? CheckCircle : p.status === "error" ? WarningCircle : CircleNotch;
  return (
    <div role="toolbar" aria-label="Annotations" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-divider bg-surface px-2 py-1 text-sm">
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={p.tool}
        disabled={p.disabled}
        onValueChange={(v) => {
          if (v === "highlight") p.onHighlight();
          else if (v) p.onTool(v as Tool);
        }}
        aria-label="Annotation tool"
      >
        {TOOLS.map((t) => (
          <ToggleGroupItem
            key={t.id}
            value={t.id}
            disabled={t.id === "highlight" && (!p.canHighlight || p.documentHasText === false)}
            aria-describedby={t.id === "highlight" && noText ? "uh-highlight-note" : undefined}
            title={t.id === "highlight" ? (noText ?? "Highlight the selected text") : undefined}
          >
            {t.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={p.disabled} aria-label={`Colour: ${color.name}`}>
            <span aria-hidden className="size-3.5 rounded-full border border-divider" style={{ background: color.fill }} />
            {color.name}
            <CaretDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Colour">
          <ColorMenuItems onPick={p.onColor} />
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-hidden className="mx-1 h-5 w-px bg-divider" />
      <Button variant="ghost" size="icon-sm" aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z" disabled={!p.canUndo} onClick={p.onUndo}>
        <ArrowArcLeft aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" disabled={!p.canRedo} onClick={p.onRedo}>
        <ArrowArcRight aria-hidden />
      </Button>
      {noText && (
        <span id="uh-highlight-note" className="px-1 text-xs text-muted-foreground">
          {noText}
        </span>
      )}
      <span role="status" aria-live="polite" data-testid="annotation-save" className={p.status === "error" ? "ml-auto inline-flex items-center gap-1 px-1 text-danger" : "ml-auto inline-flex items-center gap-1 px-1 text-muted-foreground"}>
        <StatusIcon size={14} aria-hidden className={p.status === "saving" || p.status === "pending" ? "animate-spin [animation-duration:1.5s]" : undefined} />
        {saveLabel(p.status)}
      </span>
    </div>
  );
}
