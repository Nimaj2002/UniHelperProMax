/** Reader zoom and page navigation rules (007 FR-016/FR-017, contracts/ui-reader.md). */

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** The next zoom step above (dir 1) or below (dir -1) the current scale. */
export function stepZoom(scale: number, dir: 1 | -1): number {
  const eps = 0.001;
  if (dir > 0) return ZOOM_STEPS.find((s) => s > scale + eps) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - eps) ?? MIN_ZOOM;
}

export const zoomLabel = (scale: number) => `${Math.round(scale * 100)} %`;

/**
 * A page typed into the page field: the page to show and, when the number was out of range,
 * the polite message that explains the nearest page was shown instead.
 */
export function resolvePage(input: string, pageCount: number): { page: number; message?: string } | null {
  const n = Number.parseInt(input.trim(), 10);
  if (!Number.isFinite(n) || pageCount < 1) return null;
  if (n < 1) return { page: 1, message: "The first page is page 1 — showing page 1." };
  if (n > pageCount) return { page: pageCount, message: `There are ${pageCount} pages — showing page ${pageCount}.` };
  return { page: n };
}

// ---- continuous zoom: Ctrl/Cmd + wheel, trackpad and touch pinch ---------------------------

export const clampZoom = (scale: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

const LINE_PX = 16;
const PAGE_PX = 800;

/**
 * Zoom factor for one Ctrl/Cmd + wheel event. Trackpad pinches arrive as Ctrl + wheel with small
 * pixel deltas, mouse wheels as larger ones; both zoom smoothly (wheel up/pinch out zooms in).
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaY * (deltaMode === 1 ? LINE_PX : deltaMode === 2 ? PAGE_PX : 1);
  return Math.exp(-Math.max(-100, Math.min(100, px)) * 0.01);
}

/** Scale while pinching two fingers: the start scale times how far apart they moved. */
export function pinchScale(startScale: number, startDistance: number, distance: number): number {
  return startDistance > 0 ? clampZoom((startScale * distance) / startDistance) : clampZoom(startScale);
}
