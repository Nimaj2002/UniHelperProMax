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
