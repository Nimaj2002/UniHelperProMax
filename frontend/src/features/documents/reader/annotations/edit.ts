/** Page-space helpers for drawing, moving and naming annotations (007 FR-027, FR-034). */
import type { Matrix, Rect } from "./geometry";
import { COLORS, type Annotation } from "./types";

const COMMENT_HALO = 12; // pt around a comment's anchor (its marker)
const INK_PAD = 4;

/** The annotation's bounding rect in page space. */
export function bounds(a: Annotation): Rect {
  if (a.type === "highlight" && a.rects?.length) {
    return [Math.min(...a.rects.map((r) => r[0])), Math.min(...a.rects.map((r) => r[1])), Math.max(...a.rects.map((r) => r[2])), Math.max(...a.rects.map((r) => r[3]))];
  }
  if (a.type === "ink" && a.strokes?.length) {
    const pts = a.strokes.flat();
    const pad = (a.width ?? 2) / 2 + INK_PAD;
    return [Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad, Math.max(...pts.map((p) => p[0])) + pad, Math.max(...pts.map((p) => p[1])) + pad];
  }
  if (a.type === "textbox" && a.box) return a.box;
  const [x, y] = a.anchor ?? [0, 0];
  return [x - COMMENT_HALO, y - COMMENT_HALO, x + COMMENT_HALO, y + COMMENT_HALO];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The same annotation moved by (dx, dy) points. */
export function translate(a: Annotation, dx: number, dy: number): Partial<Annotation> {
  const r = ([x1, y1, x2, y2]: number[]) => [round(x1 + dx), round(y1 + dy), round(x2 + dx), round(y2 + dy)] as Rect;
  if (a.type === "highlight") return { rects: a.rects?.map(r) };
  if (a.type === "ink") return { strokes: a.strokes?.map((s) => s.map(([x, y]) => [round(x + dx), round(y + dy)] as [number, number])) };
  if (a.type === "textbox") return { box: a.box && r(a.box) };
  return { anchor: a.anchor && [round(a.anchor[0] + dx), round(a.anchor[1] + dy)] };
}

/** A screen-space movement (CSS px) as a page-space one, through the inverse viewport transform. */
export function screenDeltaToPage(inverse: Matrix, dx: number, dy: number): [number, number] {
  return [inverse[0] * dx + inverse[2] * dy, inverse[1] * dx + inverse[3] * dy];
}

/** One step of `points` in the direction of a screen arrow key, in page space. */
export function arrowStep(inverse: Matrix, key: string, points: number): [number, number] | null {
  const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const d = dir[key];
  if (!d) return null;
  const [x, y] = screenDeltaToPage(inverse, d[0], d[1]);
  const len = Math.hypot(x, y) || 1;
  return [(x / len) * points, (y / len) * points];
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const TYPE_NAME = { highlight: "Highlight", ink: "Drawing", textbox: "Text box", comment: "Comment" } as const;

/** "Highlight, page 12: ‘red–black tree’" (research R9). */
export function accessibleName(a: Annotation): string {
  const color = COLORS.find((c) => c.id === a.color)?.name ?? a.color;
  const text = a.type === "highlight" ? (a.quoted ? `‘${clip(a.quoted)}’` : "") : clip(a.text ?? "");
  const copy = a.conflictOf ? " (version kept from another window)" : "";
  return `${TYPE_NAME[a.type]}, page ${a.page}${text ? `: ${text}` : ""}, ${color}${copy}`;
}
