import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clickDraft, draftRange, edgeSpeed, isClick, yToMinutes, type DraftRange } from "./draft";
import { canReplace, type DraftControls } from "./useDraft";

interface Drag {
  pointerId: number;
  id: number;
  day: string;
  pressMin: number;
  x: number;
  y: number;
  lastY: number;
  moved: boolean;
  range: DraftRange;
  column: HTMLElement;
}

interface Tap {
  pointerId: number;
  day: string;
  min: number;
  x: number;
  y: number;
}

/** Presses on entries (and on the draft itself) never start a draft (FR-023). */
export function startsDraft(target: EventTarget | null): boolean {
  return target instanceof Element && !target.closest("[data-session-key],[data-draft],[data-task-marker],[data-no-drag]");
}

/**
 * Press-and-drag drafts in the day/week time grid (009 US5, research R11). Pointer events on the
 * day column: the draft follows the pointer vertically inside the day it started in, snaps to 15
 * minutes, auto-scrolls near the edges, and Escape cancels. A release under 4 px is a click (a
 * one-hour draft). Touch never drags: a tap makes the one-hour draft (FR-044).
 */
export function useGridDrag(scrollRef: RefObject<HTMLElement | null>, hourPx: number, controls: DraftControls) {
  const drag = useRef<Drag | null>(null);
  const tap = useRef<Tap | null>(null);
  const raf = useRef(0);
  const latest = useRef(controls);
  useEffect(() => {
    latest.current = controls;
  });

  const minutesAt = (clientY: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    return yToMinutes(clientY - el.getBoundingClientRect().top, el.scrollTop, hourPx);
  };

  const stopScroll = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  };

  const track = (d: Drag) => {
    const range = draftRange(d.pressMin, minutesAt(d.lastY));
    if (range.startMin !== d.range.startMin || range.endMin !== d.range.endMin) {
      d.range = range;
      latest.current.update(d.id, range);
    }
  };

  const tick = () => {
    const d = drag.current;
    const el = scrollRef.current;
    if (!d || !el) return stopScroll();
    const rect = el.getBoundingClientRect();
    const speed = edgeSpeed(d.lastY, rect.top, rect.bottom);
    if (!d.moved || speed === 0) return stopScroll();
    el.scrollTop += speed;
    track(d);
    raf.current = requestAnimationFrame(tick);
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    stopScroll();
    if (d?.column.hasPointerCapture?.(d.pointerId)) d.column.releasePointerCapture(d.pointerId);
    return d;
  };

  // Escape during a drag removes the draft and nothing else (FR-027); capture phase, so the
  // grid's own Escape handling and dialogs never see it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = drag.current;
      if (e.key !== "Escape" || !d) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      if (d.column.hasPointerCapture?.(d.pointerId)) d.column.releasePointerCapture(d.pointerId);
      latest.current.discard(d.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, day: string) => {
    if (e.button !== 0 || !startsDraft(e.target) || drag.current) return;
    const state = latest.current.state;
    if (!canReplace(state)) return; // a form with something entered stays open (FR-040)
    const min = minutesAt(e.clientY);
    if (e.pointerType === "touch") {
      tap.current = { pointerId: e.pointerId, day, min, x: e.clientX, y: e.clientY };
      return; // no preventDefault: touch keeps scrolling the grid
    }
    e.preventDefault(); // no text selection, no focus jump while dragging
    const column = e.currentTarget;
    column.setPointerCapture?.(e.pointerId);
    const range = draftRange(min, min);
    drag.current = {
      pointerId: e.pointerId, id: state.nextId, day, pressMin: min,
      x: e.clientX, y: e.clientY, lastY: e.clientY, moved: false, range, column,
    };
    latest.current.start(day, range, "drag", "drag");
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastY = e.clientY;
    if (!d.moved && !isClick(e.clientX - d.x, e.clientY - d.y)) d.moved = true;
    if (!d.moved) return;
    track(d);
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const t = tap.current;
    if (t && e.pointerId === t.pointerId) {
      tap.current = null;
      if (isClick(e.clientX - t.x, e.clientY - t.y)) latest.current.start(t.day, clickDraft(t.min), "click", "open");
      return;
    }
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    end();
    latest.current.open(d.id, d.moved ? d.range : clickDraft(d.pressMin));
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>) => {
    if (tap.current?.pointerId === e.pointerId) tap.current = null;
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    end();
    latest.current.discard(d.id);
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
