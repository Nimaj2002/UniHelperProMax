import { CaretLeft, CaretRight, CircleHalf, Minus, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_ZOOM, MIN_ZOOM, resolvePage, zoomLabel } from "./zoom";

interface Props {
  /** The pages are laid out; until then the controls are disabled. */
  ready: boolean;
  page: number;
  pageCount: number;
  scale: number;
  fitWidth: boolean;
  darkPages: boolean;
  onGoTo: (page: number) => void;
  /** Explains a page-field correction (polite live region). */
  onMessage: (message: string) => void;
  onZoom: (dir: 1 | -1) => void;
  onFitWidth: () => void;
  onToggleDarkPages: () => void;
}

/** Reader toolbar (007 FR-016/FR-017/FR-022a, contracts/ui-reader.md). */
export function ReaderToolbar({ ready, page, pageCount, scale, fitWidth, darkPages, onGoTo, onMessage, onZoom, onFitWidth, onToggleDarkPages }: Props) {
  // the field shows the current page except while the user types in it
  const [draft, setDraft] = useState<string | null>(null);
  const field = draft ?? String(page);

  const jump = () => {
    const r = resolvePage(field, pageCount);
    setDraft(null);
    if (!r) return;
    onGoTo(r.page);
    if (r.message) onMessage(r.message);
  };

  return (
    <div role="toolbar" aria-label="Reader" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-divider bg-surface px-2 py-1 text-sm">
      <Button variant="ghost" size="icon-sm" aria-label="Previous page" aria-keyshortcuts="PageUp" disabled={!ready || page <= 1} onClick={() => onGoTo(page - 1)}>
        <CaretLeft aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next page" aria-keyshortcuts="PageDown" disabled={!ready || page >= pageCount} onClick={() => onGoTo(page + 1)}>
        <CaretRight aria-hidden />
      </Button>
      <label className="flex items-center gap-1.5 px-1">
        <span>Page</span>
        <input
          inputMode="numeric"
          disabled={!ready}
          aria-label={`Page number, ${pageCount} pages`}
          value={field}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setDraft(null)}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              jump();
            }
          }}
          className="h-7 w-12 rounded-md border border-input bg-background px-1.5 text-center tabular-nums disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <span aria-hidden className="text-muted-foreground tabular-nums">of {pageCount}</span>
      </label>
      <span aria-hidden className="mx-1 h-5 w-px bg-divider" />
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" aria-keyshortcuts="Control+Minus Meta+Minus" disabled={!ready || scale <= MIN_ZOOM + 0.001} onClick={() => onZoom(-1)}>
        <Minus aria-hidden />
      </Button>
      <span className="w-14 text-center tabular-nums" aria-label={`Zoom ${zoomLabel(scale)}`}>
        {zoomLabel(scale)}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom in" aria-keyshortcuts="Control+Plus Meta+Plus" disabled={!ready || scale >= MAX_ZOOM - 0.001} onClick={() => onZoom(1)}>
        <Plus aria-hidden />
      </Button>
      <Button variant="ghost" size="sm" aria-pressed={fitWidth} disabled={!ready} onClick={onFitWidth} className={cn(fitWidth && "bg-accent")}>
        Fit width
      </Button>
      <span aria-hidden className="mx-1 h-5 w-px bg-divider" />
      <Button variant="ghost" size="sm" aria-pressed={darkPages} onClick={onToggleDarkPages} className={cn(darkPages && "bg-accent")}>
        <CircleHalf aria-hidden />
        Dark pages
      </Button>
    </div>
  );
}
