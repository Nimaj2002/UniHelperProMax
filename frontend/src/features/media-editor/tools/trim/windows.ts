/** The trim tool's keep-windows (025 FR-006a/b): sorted, never overlapping. Pure, so it is unit tested. */
import { MIN_RANGE_MS } from "./time";

export interface Range {
  startMs: number;
  endMs: number;
}

export const MAX_WINDOWS = 20;
const DEFAULT_LEN_MS = 30_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where window `i` may start: after the previous window, at least 0.1 s before its own end. */
export function clampStart(ranges: Range[], i: number, ms: number): number {
  const lo = ranges[i - 1]?.endMs ?? 0;
  return clamp(Math.round(ms), lo, ranges[i].endMs - MIN_RANGE_MS);
}

/** Where window `i` may end: before the next window (or the audio's end), 0.1 s after its start. */
export function clampEnd(ranges: Range[], i: number, ms: number, total: number): number {
  const hi = ranges[i + 1]?.startMs ?? total;
  return clamp(Math.round(ms), ranges[i].startMs + MIN_RANGE_MS, hi);
}

/** Move window `i` to start at `start`, keeping its length and staying between its neighbours. */
export function moveWindow(ranges: Range[], i: number, start: number, total: number): Range[] {
  const len = ranges[i].endMs - ranges[i].startMs;
  const lo = ranges[i - 1]?.endMs ?? 0;
  const hi = (ranges[i + 1]?.startMs ?? total) - len;
  const s = Math.round(clamp(start, lo, Math.max(lo, hi)));
  return ranges.map((r, k) => (k === i ? { startMs: s, endMs: s + len } : r));
}

/** The cut parts: the gaps before, between and after the windows. */
export function gaps(ranges: Range[], total: number): Range[] {
  const out: Range[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.startMs > at) out.push({ startMs: at, endMs: r.startMs });
    at = r.endMs;
  }
  if (at < total) out.push({ startMs: at, endMs: total });
  return out;
}

export type AddResult = { ranges: Range[]; index: number } | { problem: string };

/**
 * A new window at the playhead `t`: none while `t` is inside a window; otherwise it starts at `t`
 * and runs right for up to 30 s (or a tenth of the audio), stopped by the next window or the end.
 * With no room to the right it ends at `t` and runs left, stopped by the previous window.
 */
export function addWindowAt(ranges: Range[], t: number, total: number): AddResult {
  if (ranges.length >= MAX_WINDOWS) return { problem: `At most ${MAX_WINDOWS} windows.` };
  if (ranges.some((r) => t >= r.startMs && t <= r.endMs)) {
    return { problem: "The playhead is inside a window. Move it to a cut part to add a window there." };
  }
  const want = Math.max(MIN_RANGE_MS, Math.min(DEFAULT_LEN_MS, Math.round(total / 10)));
  const next = ranges.find((r) => r.startMs > t);
  let start = Math.round(t);
  let end = Math.min(start + want, next?.startMs ?? total);
  if (end - start < MIN_RANGE_MS) {
    const prev = [...ranges].reverse().find((r) => r.endMs < t);
    end = Math.round(t);
    start = Math.max(end - want, prev?.endMs ?? 0);
    if (end - start < MIN_RANGE_MS) return { problem: "There isn't room for a window at the playhead." };
  }
  const merged = [...ranges, { startMs: start, endMs: end }].sort((a, b) => a.startMs - b.startMs);
  return { ranges: merged, index: merged.findIndex((r) => r.startMs === start && r.endMs === end) };
}

export const keptMs = (ranges: Range[]) => ranges.reduce((n, r) => n + (r.endMs - r.startMs), 0);

/** Nothing to save: one window over the whole audio. */
export const isUntouched = (ranges: Range[], total: number) =>
  ranges.length === 1 && ranges[0].startMs === 0 && ranges[0].endMs === total;
