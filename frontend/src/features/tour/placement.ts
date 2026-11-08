/**
 * 023 research R6/R7: where Yuii stands and which pose she uses. Pure maths so it is unit
 * tested. Yuii and her bubble form one column (bubble on top) beside the target; base poses
 * point to the viewer's left, so standing left of the target means a mirrored image.
 */
export type Pose =
  | "point-left"
  | "point-left-low"
  | "point-left-arm-extended"
  | "point-up-left"
  | "point-up-left-high";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Viewport {
  w: number;
  h: number;
}

export interface Placement {
  /** full: large Yuii; small: shrunk; bubble: no Yuii; center: no target. */
  mode: "full" | "small" | "bubble" | "center";
  side: "left" | "right";
  /** Top-left corner of Yuii's image (or of the bubble when mode is "bubble"). */
  x: number;
  y: number;
  /** Image size; 0 in bubble mode. */
  height: number;
  width: number;
  pose: Pose;
  mirrored: boolean;
  bubble: { x: number; y: number; width: number };
}

export const MARGIN = 16;
export const PAD = 8; // the highlight ring around the target
export const BUBBLE_W = 340;
export const BUBBLE_H = 200; // room reserved above Yuii for the bubble
const GAP = 12;
const MIN_H = 160;
const MAX_H = 340;
const ASPECT = 1.27; // pointing busts are ~446×351
const HAND = 0.54; // the pointing hand's height as a fraction of the image

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.max(lo, v)));

export function pickPose(dx: number, dy: number): Pose {
  // dy > 0: target above the hand
  const angle = (Math.atan2(dy, Math.max(1, dx)) * 180) / Math.PI;
  if (angle > 35) return "point-up-left-high";
  if (angle > 12) return "point-up-left";
  if (angle < -12) return "point-left-low";
  return dx > 260 ? "point-left-arm-extended" : "point-left";
}

export function place(target: Rect | null, vp: Viewport): Placement {
  const fullH = Math.min(vp.h * 0.33, MAX_H);
  if (!target) {
    const width = Math.min(BUBBLE_W, vp.w - 2 * MARGIN);
    const height = Math.max(0, Math.min(fullH, vp.h - BUBBLE_H - 2 * MARGIN));
    const x = (vp.w - height * ASPECT) / 2;
    const y = (vp.h - height - BUBBLE_H) / 2 + BUBBLE_H;
    return {
      mode: "center",
      side: "right",
      x,
      y,
      height,
      width: height * ASPECT,
      pose: "point-left",
      mirrored: false,
      bubble: { x: (vp.w - width) / 2, y: y - BUBBLE_H, width },
    };
  }

  const t = { left: target.left - PAD, top: target.top - PAD, right: target.left + target.width + PAD, bottom: target.top + target.height + PAD };
  const room = { right: vp.w - t.right - GAP - MARGIN, left: t.left - GAP - MARGIN };
  const side: "left" | "right" = room.right >= room.left ? "right" : "left";
  const space = room[side];
  const cy = (t.top + t.bottom) / 2;

  // largest Yuii that fits the free side and the window height
  let height = Math.min(fullH, space / ASPECT, vp.h - BUBBLE_H - 2 * MARGIN);
  const columnW = (h: number) => Math.max(h * ASPECT, BUBBLE_W);
  let mode: Placement["mode"] = height >= fullH - 0.5 ? "full" : "small";
  if (height < MIN_H || columnW(height) > space) {
    // the bubble alone still has to fit beside the target
    height = 0;
    mode = "bubble";
  }
  const width = height * ASPECT;
  const colW = mode === "bubble" ? Math.min(BUBBLE_W, Math.max(space, 0)) : columnW(height);
  const colX = side === "right" ? t.right + GAP : t.left - GAP - colW;

  if (mode === "bubble" && space < BUBBLE_W) {
    // nothing fits beside the target (a wide panel): bubble below or above it, else a corner
    const below = vp.h - t.bottom - GAP - MARGIN;
    const above = t.top - GAP - MARGIN;
    const bw = Math.min(BUBBLE_W, vp.w - 2 * MARGIN);
    const bx = clamp((t.left + t.right) / 2 - bw / 2, MARGIN, vp.w - MARGIN - bw);
    const by =
      Math.max(below, above) >= BUBBLE_H
        ? below >= above
          ? t.bottom + GAP
          : t.top - GAP - BUBBLE_H
        : vp.h - MARGIN - BUBBLE_H; // the target fills the window; overlapping it is unavoidable
    return { mode, side, x: bx, y: by, height: 0, width: 0, pose: "point-left", mirrored: false, bubble: { x: bx, y: by, width: bw } };
  }

  if (mode === "bubble") {
    const by = clamp(cy - BUBBLE_H / 2, MARGIN, vp.h - MARGIN - BUBBLE_H);
    const bx = clamp(colX, MARGIN, vp.w - MARGIN - colW);
    return { mode, side, x: bx, y: by, height: 0, width: 0, pose: "point-left", mirrored: side === "left", bubble: { x: bx, y: by, width: colW } };
  }

  // Yuii's image hugs the target side of the column, hand level with the target centre if possible
  const x = side === "right" ? colX : colX + colW - width;
  const y = clamp(cy - height * HAND, MARGIN + BUBBLE_H, vp.h - MARGIN - height);
  const handX = side === "right" ? x : x + width;
  const handY = y + height * HAND;
  const dx = side === "right" ? handX - t.right : t.left - handX;
  const pose = pickPose(Math.max(dx, 0) + target.width / 2, handY - cy);
  const bw = Math.min(BUBBLE_W, colW);
  return {
    mode,
    side,
    x,
    y,
    height,
    width,
    pose,
    mirrored: side === "left",
    bubble: { x: side === "right" ? colX : colX + colW - bw, y: y - BUBBLE_H, width: bw },
  };
}
