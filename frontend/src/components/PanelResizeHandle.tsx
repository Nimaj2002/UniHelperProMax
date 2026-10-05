import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

/** Pointer/arrow direction that makes the value larger. */
type Grow = "left" | "right" | "up" | "down";

interface Props {
  /** Current size of the resized area (px, or % when `unitsPerPx` converts). */
  value: number;
  min: number;
  max: number;
  /** Tighter upper bound read when an interaction starts (e.g. from the container size). */
  limit?: () => number;
  defaultValue: number;
  /** Commits a size: once when a drag ends, and on each keyboard step. */
  onResize: (value: number) => void;
  /**
   * Live preview while dragging, at most once per frame. Apply it straight to the DOM (e.g. a
   * CSS variable) so nothing re-renders mid-drag; without it every move goes to `onResize`.
   */
  onDrag?: (value: number) => void;
  grow: Grow;
  label: string;
  controls: string;
  /** Keyboard step in value units. */
  step?: number;
  /** Converts a pointer movement in px to value units (e.g. 100 / container height for %). */
  unitsPerPx?: () => number;
  className?: string;
}

const AXIS: Record<Grow, { horizontal: boolean; sign: 1 | -1; more: string; less: string }> = {
  left: { horizontal: true, sign: -1, more: "ArrowLeft", less: "ArrowRight" },
  right: { horizontal: true, sign: 1, more: "ArrowRight", less: "ArrowLeft" },
  up: { horizontal: false, sign: -1, more: "ArrowUp", less: "ArrowDown" },
  down: { horizontal: false, sign: 1, more: "ArrowDown", less: "ArrowUp" },
};

/**
 * Splitter between two panels (WAI-ARIA window splitter): drag with the pointer, or focus it
 * and use the arrow keys (Home/End for min/max); double-click or Enter restores the default.
 * The edge lights up with a grip on hover, focus and while dragging.
 */
export function PanelResizeHandle({ value, min, max, limit, defaultValue, onResize, onDrag, grow, label, controls, step = 16, unitsPerPx, className }: Props) {
  const drag = useRef<{ at: number; value: number; scale: number; max: number; last: number | null; frame: number } | null>(null);
  const { horizontal, sign, more, less } = AXIS[grow];
  const maxNow = () => Math.max(min, Math.min(max, limit?.() ?? max));
  const clamp = (v: number, hi = maxNow()) => Math.round(Math.max(min, Math.min(hi, v)));
  const pos = (e: PointerEvent) => (horizontal ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const hi = maxNow();
    drag.current = { at: pos(e), value: clamp(value, hi), scale: unitsPerPx?.() ?? 1, max: hi, last: null, frame: 0 };
    // keep the resize cursor and avoid selecting text while the pointer is outside the handle
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const v = clamp(d.value + sign * (pos(e) - d.at) * d.scale, d.max);
    if (v === d.last) return;
    d.last = v;
    if (!onDrag) return onResize(v);
    const el = e.currentTarget;
    d.frame ||= requestAnimationFrame(() => {
      d.frame = 0;
      if (d.last === null) return;
      onDrag(d.last);
      el.setAttribute("aria-valuenow", String(d.last));
    });
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    cancelAnimationFrame(d.frame);
    if (onDrag && d.last !== null) {
      onDrag(d.last);
      onResize(d.last);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const hi = maxNow();
    const now = clamp(value, hi);
    const next: Record<string, number> = { [more]: now + step, [less]: now - step, Home: min, End: hi, Enter: defaultValue };
    if (!(e.key in next)) return;
    e.preventDefault();
    onResize(clamp(next[e.key], hi));
  };

  return (
    // a focusable separator is an interactive widget (WAI-ARIA window splitter pattern)
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      // a vertical separator sits between side-by-side panels and resizes their width
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onResize(clamp(defaultValue))}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute z-10 flex touch-none items-center justify-center rounded-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        horizontal ? "inset-y-0 w-2 -translate-x-1/2 cursor-col-resize" : "inset-x-0 h-2 -translate-y-1/2 cursor-row-resize",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "bg-transparent transition-colors group-hover:bg-primary group-focus-visible:bg-ring group-active:bg-primary",
          horizontal
            ? "h-full w-px group-hover:w-0.5 group-focus-visible:w-0.5 group-active:w-0.5"
            : "h-px w-full group-hover:h-0.5 group-focus-visible:h-0.5 group-active:h-0.5",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute rounded-full bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100",
          horizontal ? "h-8 w-1.5" : "h-1.5 w-8",
        )}
      />
    </div>
  );
}
