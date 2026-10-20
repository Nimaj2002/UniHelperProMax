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
/** The session panel (014 FR-008): 300–640 px, never more than half the window. */
export const RIGHT_MIN = 300;
export const RIGHT_MAX = 640;
export const RIGHT_DEFAULT = 360;
/** The closed session panel's rail on the right edge (014 FR-005). */
export const RIGHT_RAIL_W = 44;
export const MAIN_MIN = 480;

export type LayoutMode = "docked" | "overlay";

export interface WidthInput {
  viewport: number;
  mode: LayoutMode;
  focus: boolean;
  leftClosed: boolean;
  leftWidth: number;
  /** A right card exists on this page (the session workspace's session panel). */
  rightPresent: boolean;
  rightClosed: boolean;
  rightWidth: number;
  /** The right card closes to a rail (the session panel) instead of disappearing. */
  rightHasRail?: boolean;
}

export interface Widths {
  /** 0 (hidden), RAIL_W (closed) or the open width. */
  leftEff: number;
  /** 0 (hidden, or closed without a rail), RIGHT_RAIL_W (the rail) or the open width. */
  rightEff: number;
  /** The right card shows as its rail (closed, narrow window, or no room to dock it). */
  rightRail: boolean;
  /** The right card fits docked next to the main card (else it opens as an overlay). */
  rightFits: boolean;
  mainMin: number;
  /** Largest width the left card may be resized to now (keeps the main card ≥ MAIN_MIN). */
  leftLimit: number;
  rightLimit: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampLeft = (w: number) => clamp(Number.isFinite(w) ? w : LEFT_DEFAULT, LEFT_MIN, LEFT_MAX);
/** The right card's widest width in this window: 640 px and half the window (014 FR-008). */
export const rightMax = (viewport: number) => Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, Math.floor(viewport / 2)));
export const clampRight = (w: number, viewport = Infinity) => clamp(Number.isFinite(w) ? w : RIGHT_DEFAULT, RIGHT_MIN, rightMax(viewport));

export function layoutWidths(i: WidthInput): Widths {
  const docked = i.mode === "docked" && !i.focus;
  let left = !docked ? 0 : i.leftClosed ? RAIL_W : clampLeft(i.leftWidth);
  // the panel docks only if it fits at its minimum next to a 480 px main card, with the side
  // panel at its minimum; otherwise it closes to its rail and opens as an overlay (014 FR-008)
  const leftAtMin = i.mode !== "docked" ? 0 : i.leftClosed ? RAIL_W : LEFT_MIN;
  const rightFits =
    i.mode === "docked" &&
    i.rightPresent &&
    RIGHT_MIN <= Math.floor(i.viewport / 2) &&
    leftAtMin + RIGHT_MIN + MAIN_MIN + (leftAtMin ? 4 : 3) * GAP <= i.viewport;
  let right = docked && rightFits && !i.rightClosed ? clampRight(i.rightWidth, i.viewport) : 0;
  const rightRail = right === 0 && i.rightPresent && !!i.rightHasRail && !i.focus;
  if (rightRail) right = RIGHT_RAIL_W;
  const cards = 1 + (left > 0 ? 1 : 0) + (right > 0 ? 1 : 0);
  const chrome = (cards + 1) * GAP;
  // too narrow for both: shrink the session panel first, then the side panel, to their minimums
  let excess = left + right + MAIN_MIN + chrome - i.viewport;
  if (excess > 0 && right > 0 && !rightRail) {
    const cut = Math.min(excess, right - RIGHT_MIN);
    right -= cut;
    excess -= cut;
  }
  if (excess > 0 && left > RAIL_W) left -= Math.min(excess, left - LEFT_MIN);
  const room = i.viewport - chrome - MAIN_MIN;
  return {
    leftEff: left,
    rightEff: right,
    rightRail,
    rightFits,
    mainMin: MAIN_MIN,
    leftLimit: Math.max(LEFT_MIN, Math.min(LEFT_MAX, room - right)),
    rightLimit: Math.max(RIGHT_MIN, Math.min(rightMax(i.viewport), room - left)),
  };
}
