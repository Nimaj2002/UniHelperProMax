/**
 * New-entry drafts on the calendar (009 US5, research R11): pure time math for press-and-drag,
 * click, month and keyboard drafts. Minutes are since midnight of the draft's day.
 */
import { formatHHmm } from "@/lib/dates";

export const SNAP_MIN = 15;
export const MIN_DRAFT_MIN = 15;
export const DAY_MIN = 24 * 60;
/** A release closer than this to the press is a click, not a drag (FR-029). */
export const CLICK_PX = 4;
export const CLICK_DRAFT_MIN = 60;
export const MONTH_DRAFT = { startMin: 9 * 60, endMin: 10 * 60 };

export type DraftOrigin = "drag" | "click" | "keyboard" | "month";

export interface DraftRange {
  startMin: number;
  endMin: number;
}

export interface Draft extends DraftRange {
  /** Increases with every new draft, so a late "discard" of an old one never hits a new one. */
  id: number;
  date: string;
  origin: DraftOrigin;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Pointer offset (px from the scroller's visible top) plus its scroll offset → minutes. */
export function yToMinutes(offsetY: number, scrollTop: number, hourPx: number): number {
  return clamp(((offsetY + scrollTop) / hourPx) * 60, 0, DAY_MIN);
}

/** Start of the 15-minute slot holding `min`. */
export function snap15(min: number): number {
  return clamp(Math.floor(min / SNAP_MIN) * SNAP_MIN, 0, DAY_MIN - SNAP_MIN);
}

/** The range a drag covers: every slot from the pressed one to the pointer's, in either
 * direction, never under 15 minutes and always inside the day (FR-024, FR-025). */
export function draftRange(pressMin: number, pointerMin: number): DraftRange {
  const a = snap15(pressMin);
  const b = snap15(clamp(pointerMin, 0, DAY_MIN));
  const startMin = Math.min(a, b);
  const endMin = clamp(Math.max(a, b) + SNAP_MIN, startMin + MIN_DRAFT_MIN, DAY_MIN);
  return { startMin, endMin };
}

export function isClick(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) < CLICK_PX;
}

/** A click (or tap) draft: one hour from the clicked slot, ending at midnight at the latest. */
export function clickDraft(min: number): DraftRange {
  const startMin = snap15(min);
  return { startMin, endMin: Math.min(startMin + CLICK_DRAFT_MIN, DAY_MIN) };
}

/** The draft's times for a time input: midnight at the end becomes 23:59 (inputs and the API
 * have no 24:00). */
export function timeValue(min: number): string {
  return formatHHmm(Math.min(min, DAY_MIN - 1));
}

/** "13:00 – 14:45" (the end of the day reads 24:00). */
export function rangeLabel(r: DraftRange): string {
  const end = r.endMin >= DAY_MIN ? "24:00" : formatHHmm(r.endMin);
  return `${formatHHmm(r.startMin)} – ${end}`;
}

export function announcement(r: DraftRange): string {
  const end = r.endMin >= DAY_MIN ? "24:00" : formatHHmm(r.endMin);
  return `New entry, from ${formatHHmm(r.startMin)} to ${end}`;
}

/** Keyboard selection (009 US7, research R13): a range of 15-minute slots on one day. */
export interface KeyRange {
  day: number; // column index
  slot: number; // first slot
  len: number; // slots, ≥ 1
}

export const SLOTS_PER_DAY = DAY_MIN / SNAP_MIN;

export type RangeKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** Arrow keys move the range (by 15 minutes or a day); with Shift, ↓/↑ extend/shorten it. */
export function moveRange(r: KeyRange, key: RangeKey, shift: boolean, days: number): KeyRange {
  if (shift && key === "ArrowDown") return { ...r, len: Math.min(r.len + 1, SLOTS_PER_DAY - r.slot) };
  if (shift && key === "ArrowUp") return { ...r, len: Math.max(1, r.len - 1) };
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const day = clamp(r.day + (key === "ArrowRight" ? 1 : -1), 0, days - 1);
    return { ...r, day };
  }
  const slot = clamp(r.slot + (key === "ArrowDown" ? 1 : -1), 0, SLOTS_PER_DAY - r.len);
  return { ...r, slot };
}

export function keyRangeMinutes(r: KeyRange): DraftRange {
  return { startMin: r.slot * SNAP_MIN, endMin: (r.slot + r.len) * SNAP_MIN };
}

/** Auto-scroll while dragging near the scroller's top or bottom edge (FR-026): 4–16 px per
 * frame, faster closer to the edge; negative scrolls up, 0 outside the 32 px bands. */
export const EDGE_PX = 32;

export function edgeSpeed(clientY: number, top: number, bottom: number): number {
  const fromTop = clientY - top;
  const fromBottom = bottom - clientY;
  const speed = (d: number) => Math.round(4 + 12 * (1 - clamp(d, 0, EDGE_PX) / EDGE_PX));
  if (fromTop < EDGE_PX) return -speed(fromTop);
  if (fromBottom < EDGE_PX) return speed(fromBottom);
  return 0;
}
