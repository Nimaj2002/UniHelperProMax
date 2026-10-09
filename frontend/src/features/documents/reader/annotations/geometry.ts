/**
 * Annotation geometry (007 research R6): annotations are stored in PDF page space (points,
 * unrotated, origin bottom-left) and drawn through the page viewport's transform, so zoom,
 * rotation and split view never move them.
 */

/** Affine matrix [a, b, c, d, e, f] as used by pdf.js (`viewport.transform`). */
export type Matrix = readonly [number, number, number, number, number, number];
export type Point = [number, number];
/** [x1, y1, x2, y2] in page space. */
export type Rect = [number, number, number, number];

/** The same transform pdf.js's PageViewport computes (here so the maths can be unit-tested). */
export function viewportTransform({ viewBox, scale, rotation }: { viewBox: readonly number[]; scale: number; rotation: number }): Matrix {
  const [x0, y0, x1, y1] = viewBox;
  const cx = (x1 + x0) / 2;
  const cy = (y1 + y0) / 2;
  const r = ((rotation % 360) + 360) % 360;
  const [a, b, c, d] = r === 90 ? [0, 1, 1, 0] : r === 180 ? [-1, 0, 0, 1] : r === 270 ? [0, -1, -1, 0] : [1, 0, 0, -1];
  const ox = (a === 0 ? Math.abs(cy - y0) : Math.abs(cx - x0)) * scale;
  const oy = (a === 0 ? Math.abs(cx - x0) : Math.abs(cy - y0)) * scale;
  return [a * scale, b * scale, c * scale, d * scale, ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

const apply = (m: Matrix, [x, y]: Point): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export const pageToViewport = (m: Matrix, p: Point): Point => apply(m, p);
export const viewportToPage = (inverse: Matrix, p: Point): Point => apply(inverse, p);

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A page-space rect as a box in viewport (CSS px of the page) coordinates. */
export function rectToViewport(m: Matrix, [x1, y1, x2, y2]: readonly number[]): Box {
  const [ax, ay] = apply(m, [x1, y1]);
  const [bx, by] = apply(m, [x2, y2]);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/** A viewport box (e.g. dragged on screen) as a normalised page-space rect. */
export function boxToPage(inverse: Matrix, b: Box): Rect {
  const [ax, ay] = apply(inverse, [b.left, b.top]);
  const [bx, by] = apply(inverse, [b.left + b.width, b.top + b.height]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

const round = (n: number) => Math.round(n * 100) / 100;

interface ClientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The rects of a text selection (`range.getClientRects()`, screen px) on one page as page-space
 * rects, merged into one rect per line (FR-025 Highlight). `page` is the page's on-screen origin.
 */
export function selectionToRects(rects: ClientRect[], page: { left: number; top: number }, inverse: Matrix): Rect[] {
  const boxes = rects
    .filter((r) => r.right - r.left >= 1 && r.bottom - r.top >= 1)
    .map((r) => boxToPage(inverse, { left: r.left - page.left, top: r.top - page.top, width: r.right - r.left, height: r.bottom - r.top }));
  const lines: Rect[] = [];
  for (const b of boxes.sort((p, q) => q[3] - p[3] || p[0] - q[0])) {
    const line = lines.find((l) => {
      const overlap = Math.min(l[3], b[3]) - Math.max(l[1], b[1]);
      return overlap >= 0.5 * Math.min(l[3] - l[1], b[3] - b[1]) && b[0] <= l[2] + 3 && b[2] >= l[0] - 3;
    });
    if (line) {
      line[0] = Math.min(line[0], b[0]);
      line[1] = Math.min(line[1], b[1]);
      line[2] = Math.max(line[2], b[2]);
      line[3] = Math.max(line[3], b[3]);
    } else lines.push([...b]);
  }
  return lines.map((l) => l.map(round) as Rect);
}
