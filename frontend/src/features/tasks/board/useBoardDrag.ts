/**
 * Pointer drag-and-drop for the task board (research R1): cards between and within columns, and
 * columns by their header handle.
 *
 * Portions adapted from Astryx (github.com/facebook/astryx), © Meta Platforms, Inc., MIT License
 * (design/reference/astryx-kanban-board.tsx: element registries with stable ref callbacks, the
 * DragState shape, rect-based hit-testing and the drag threshold).
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Added here: the 4 px click threshold (`isClick`), ignoring presses on a card's own controls,
 * pointer capture on the board once a drag starts, cancel on pointercancel / lostpointercapture /
 * window blur / Escape (FR-017), a rAF loop that throttles state updates and auto-scrolls the
 * board horizontally and the hovered column vertically (`edgeSpeed`, FR-018), and suppression of
 * the click that follows a completed drag (FR-019).
 */
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { edgeSpeed, isClick } from "@/features/calendar/draft";
import { computeColumnIndex, computeTarget, originOf, sameTarget, type BoardLayout, type DropTarget, type Placed } from "./dropTarget";

/** Presses inside these never start a drag, unless on an element marked `data-drag-surface`. */
export const NO_DRAG = "button, a, input, textarea, select, [role=menuitem], [role=menu], [data-no-drag]";

/** The scrolling body inside a registered column element. */
export const COLUMN_SCROLL = "[data-column-scroll]";

export type DragMode = "card" | "column";

/** Live state of a pointer drag; coordinates are in viewport space. For a column drag the target
 * is `{columnId: <dragged column>, index: <new board index>}`. */
export interface DragState {
  mode: DragMode;
  id: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  target: DropTarget | null;
}

export interface BoardDragOptions {
  /** Columns and their rendered task ids, in order (read when a drag starts and each frame). */
  getLayout: () => BoardLayout;
  /** A card was dropped somewhere else than where it started (indexes among visible cards). */
  onDrop: (taskId: string, target: DropTarget) => void;
  /** A column was dropped at another board index. */
  onColumnDrop?: (columnId: string, index: number) => void;
  /** A started drag was cancelled (Escape, interruption). */
  onCancel?: (mode: DragMode, id: string) => void;
}

interface Session {
  mode: DragMode;
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  el: HTMLElement;
  origin: DropTarget | null;
  state: DragState | null;
  frame: number;
}

type RefCb = (el: HTMLElement | null) => void;

/** Element registry with stable ref callbacks, so registering never churns across renders. */
function registry() {
  const els = new Map<string, HTMLElement>();
  const cbs = new Map<string, RefCb>();
  const register = (id: string): RefCb => {
    let cb = cbs.get(id);
    if (!cb) {
      cb = (el) => {
        if (el) els.set(id, el);
        else els.delete(id);
      };
      cbs.set(id, cb);
    }
    return cb;
  };
  return { els, register };
}

const rectOf = (el: HTMLElement) => el.getBoundingClientRect();

/** The drag machinery; created once per board so listener identities stay stable. */
function createDragEngine(setDrag: (state: DragState | null) => void, initial: BoardDragOptions) {
  const latest = { current: initial };
  const boardRef = { current: null as HTMLDivElement | null };
  const columns = registry();
  const cards = registry();
  let session: Session | null = null;

  const placedColumns = (layout: BoardLayout): Placed[] =>
    layout.flatMap((c) => {
      const el = columns.els.get(c.id);
      return el ? [{ id: c.id, rect: rectOf(el) }] : [];
    });

  const targetAt = (s: Session): DropTarget | null => {
    const layout = latest.current.getLayout();
    if (s.mode === "column") return { columnId: s.id, index: computeColumnIndex(s.x, placedColumns(layout), s.id) };
    const cardRects: Record<string, Placed[]> = {};
    for (const col of layout)
      cardRects[col.id] = col.taskIds.flatMap((id) => {
        const el = cards.els.get(id);
        return el ? [{ id, rect: rectOf(el) }] : [];
      });
    return computeTarget(s.x, s.y, placedColumns(layout), cardRects, s.id);
  };

  /** One animation frame of a running drag: auto-scroll, hit-test, publish the state. */
  const frame = () => {
    const s = session;
    if (!s?.started || !s.state) return;
    const board = boardRef.current;
    if (board) {
      const r = board.getBoundingClientRect();
      const dx = edgeSpeed(s.x, r.left, r.right);
      if (dx) board.scrollLeft += dx;
    }
    if (s.mode === "card") {
      const hovered = [...columns.els.values()].find((el) => {
        const r = rectOf(el);
        return s.x >= r.left && s.x <= r.right;
      });
      const scroller = hovered?.querySelector<HTMLElement>(COLUMN_SCROLL);
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const dy = edgeSpeed(s.y, r.top, r.bottom);
        if (dy) scroller.scrollTop += dy;
      }
    }
    const target = targetAt(s);
    const prev = s.state;
    const moved = prev.pointerX !== s.x || prev.pointerY !== s.y;
    const retargeted = (prev.target === null) !== (target === null) || (target !== null && !sameTarget(prev.target, target));
    if (moved || retargeted) {
      s.state = { ...prev, pointerX: s.x, pointerY: s.y, target };
      setDrag(s.state);
    }
    s.frame = requestAnimationFrame(frame);
  };

  const detach = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("keydown", onKey, true);
    boardRef.current?.removeEventListener("lostpointercapture", onLost);
  };

  const finish = (s: Session) => {
    detach();
    session = null;
    if (s.frame) cancelAnimationFrame(s.frame);
    const board = boardRef.current;
    if (board?.hasPointerCapture?.(s.pointerId)) board.releasePointerCapture(s.pointerId);
    if (s.started) setDrag(null);
  };

  const cancel = () => {
    const s = session;
    if (!s) return;
    finish(s);
    if (s.started) latest.current.onCancel?.(s.mode, s.id);
  };

  const start = (s: Session) => {
    const rect = rectOf(s.el);
    s.started = true;
    const board = boardRef.current;
    // capture on the board: it stays mounted while the dragged element leaves the list
    try {
      board?.setPointerCapture?.(s.pointerId);
    } catch {
      /* the pointer is already gone: the next event ends the drag */
    }
    board?.addEventListener("lostpointercapture", onLost);
    s.state = {
      mode: s.mode,
      id: s.id,
      width: rect.width,
      height: rect.height,
      offsetX: s.startX - rect.left,
      offsetY: s.startY - rect.top,
      pointerX: s.x,
      pointerY: s.y,
      target: targetAt(s),
    };
    setDrag(s.state);
    s.frame = requestAnimationFrame(frame);
  };

  function onMove(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.started && !isClick(s.x - s.startX, s.y - s.startY)) start(s);
  }

  function onUp(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.started) return finish(s); // a click: let it through
    const target = targetAt(s);
    finish(s);
    suppressNextClick();
    const { onDrop, onColumnDrop, onCancel } = latest.current;
    if (s.mode === "column") {
      if (target && target.index !== s.origin?.index) onColumnDrop?.(s.id, target.index);
      else onCancel?.(s.mode, s.id);
    } else if (target && !sameTarget(target, s.origin)) onDrop(s.id, target);
    else onCancel?.(s.mode, s.id);
  }

  function onPointerCancel(e: PointerEvent) {
    if (session && e.pointerId === session.pointerId) cancel();
  }
  function onLost(e: PointerEvent) {
    if (session?.started && e.pointerId === session.pointerId) cancel();
  }
  function onBlur() {
    cancel();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape" || !session?.started) return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }

  const begin = (e: ReactPointerEvent<HTMLElement>, mode: DragMode, id: string, el: HTMLElement | undefined) => {
    if (e.button !== 0 || session || !el) return;
    const control = (e.target as Element).closest(NO_DRAG);
    if (control && !control.hasAttribute("data-drag-surface")) return;
    const layout = latest.current.getLayout();
    const origin = mode === "column" ? { columnId: id, index: layout.findIndex((c) => c.id === id) } : originOf(layout, id);
    session = {
      mode, id, el, origin, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY, started: false, state: null, frame: 0,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey, true);
  };

  return {
    setOptions: (options: BoardDragOptions) => {
      latest.current = options;
    },
    /** Callback ref for the horizontal scroller. */
    boardRef: (el: HTMLDivElement | null) => {
      boardRef.current = el;
    },
    onCardPointerDown: (e: ReactPointerEvent<HTMLElement>, taskId: string) => begin(e, "card", taskId, cards.els.get(taskId)),
    onColumnPointerDown: (e: ReactPointerEvent<HTMLElement>, columnId: string) =>
      begin(e, "column", columnId, columns.els.get(columnId)),
    registerColumn: columns.register,
    registerCard: cards.register,
    dispose: () => {
      if (session?.frame) cancelAnimationFrame(session.frame);
      detach();
      session = null;
    },
  };
}

export function useBoardDrag(options: BoardDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [engine] = useState(() => createDragEngine(setDrag, options));
  useEffect(() => engine.setOptions(options));

  // no text selection while dragging; detach everything on unmount
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [dragging]);
  useEffect(() => () => engine.dispose(), [engine]);

  return {
    drag,
    onCardPointerDown: engine.onCardPointerDown,
    onColumnPointerDown: engine.onColumnPointerDown,
    registerColumn: engine.registerColumn,
    registerCard: engine.registerCard,
    boardRef: engine.boardRef,
  };
}

/** Swallow the click that a browser fires after a drag's pointerup (FR-019). */
function suppressNextClick() {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}
