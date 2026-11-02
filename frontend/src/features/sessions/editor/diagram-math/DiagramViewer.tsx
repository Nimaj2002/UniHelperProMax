import { ArrowCounterClockwise, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { matchFirst } from "@/lib/keymap";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  svg: string;
  title: string;
}

const STEP = 1.25;
const PAN = 40;

const DIAGRAM_COMMANDS = ["diagram.zoomIn", "diagram.zoomOut", "diagram.reset", "diagram.panLeft", "diagram.panRight", "diagram.panUp", "diagram.panDown"] as const;

/** A drawn diagram, large, with zoom and panning (FR-042). Escape closes it; focus returns to the diagram. */
export function DiagramViewer({ open, onOpenChange, svg, title }: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const zoomBy = (f: number) => setZoom((z) => Math.min(8, Math.max(0.25, z * f)));

  const onKeyDown = (e: KeyboardEvent) => {
    // keys from the 019 keymap
    const actions: Record<(typeof DIAGRAM_COMMANDS)[number], () => void> = {
      "diagram.zoomIn": () => zoomBy(STEP),
      "diagram.zoomOut": () => zoomBy(1 / STEP),
      "diagram.reset": reset,
      "diagram.panLeft": () => setPan((p) => ({ ...p, x: p.x + PAN })),
      "diagram.panRight": () => setPan((p) => ({ ...p, x: p.x - PAN })),
      "diagram.panUp": () => setPan((p) => ({ ...p, y: p.y + PAN })),
      "diagram.panDown": () => setPan((p) => ({ ...p, y: p.y - PAN })),
    };
    const command = matchFirst(e.nativeEvent, DIAGRAM_COMMANDS);
    if (command) {
      e.preventDefault();
      actions[command]();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent data-uh="diagram-viewer" className="flex h-[85vh] w-[92vw] max-w-[92vw] flex-col gap-3 sm:max-w-[92vw]" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2 pr-10">
          <DialogTitle className="min-w-0 flex-1 truncate">{title}</DialogTitle>
          <DialogDescription className="sr-only">Zoom with + and −, reset with 0, and move the diagram with the arrow keys or by dragging.</DialogDescription>
          <Button variant="outline" size="icon" aria-label="Zoom out" onClick={() => zoomBy(1 / STEP)}>
            <MagnifyingGlassMinus size={18} />
          </Button>
          <span className="w-14 text-center text-sm tabular-nums text-text-muted" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="outline" size="icon" aria-label="Zoom in" onClick={() => zoomBy(STEP)}>
            <MagnifyingGlassPlus size={18} />
          </Button>
          <Button variant="outline" size="icon" aria-label="Reset zoom" onClick={reset}>
            <ArrowCounterClockwise size={18} />
          </Button>
        </div>
        <div
          className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden rounded-md border border-border bg-editor-surface active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
        >
          <div
            className="uh-viewer-canvas absolute inset-0 grid place-items-center"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
