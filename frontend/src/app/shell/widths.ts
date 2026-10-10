/**
 * Card widths (008 research R11). The window is a grid of up to three cards with an 8 px gap
 * between them and to the window edge; the main card never gets narrower than 480 px. Stored
 * widths are preferences: they are clamped here for display, never rewritten.
 */
export const GAP = 8;
export const RAIL_W = 44;
export const LEFT_MIN = 240;
export const LEFT_MAX = 480;
export const LEFT_DEFAULT = 280;
export const RIGHT_MIN = 260;
export const RIGHT_MAX = 640;
export const RIGHT_DEFAULT = 300;
export const MAIN_MIN = 480;

export type LayoutMode = "docked" | "overlay";

export interface WidthInput {
  viewport: number;
  mode: LayoutMode;
  focus: boolean;
  leftClosed: boolean;
  leftWidth: number;
  /** A right card exists on this page (the session workspace's audio card). */
  rightPresent: boolean;
  rightClosed: boolean;
  rightWidth: number;
}

export interface Widths {
  /** 0 (hidden), RAIL_W (closed) or the open width. */
  leftEff: number;
  /** 0 (hidden or closed) or the open width. */
  rightEff: number;
  mainMin: number;
  /** Largest width the left card may be resized to now (keeps the main card ≥ MAIN_MIN). */
  leftLimit: number;
  rightLimit: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampLeft = (w: number) => clamp(Number.isFinite(w) ? w : LEFT_DEFAULT, LEFT_MIN, LEFT_MAX);
export const clampRight = (w: number) => clamp(Number.isFinite(w) ? w : RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX);

export function layoutWidths(i: WidthInput): Widths {
  const docked = i.mode === "docked" && !i.focus;
  let left = !docked ? 0 : i.leftClosed ? RAIL_W : clampLeft(i.leftWidth);
  let right = docked && i.rightPresent && !i.rightClosed ? clampRight(i.rightWidth) : 0;
  const cards = 1 + (left > 0 ? 1 : 0) + (right > 0 ? 1 : 0);
  const chrome = (cards + 1) * GAP;
  // too narrow for both: shrink the audio card first, then the side panel, to their minimums
  let excess = left + right + MAIN_MIN + chrome - i.viewport;
  if (excess > 0 && right > 0) {
    const cut = Math.min(excess, right - RIGHT_MIN);
    right -= cut;
    excess -= cut;
  }
  if (excess > 0 && left > RAIL_W) left -= Math.min(excess, left - LEFT_MIN);
  const room = i.viewport - chrome - MAIN_MIN;
  return {
    leftEff: left,
    rightEff: right,
    mainMin: MAIN_MIN,
    leftLimit: Math.max(LEFT_MIN, Math.min(LEFT_MAX, room - right)),
    rightLimit: Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, room - left)),
  };
}
