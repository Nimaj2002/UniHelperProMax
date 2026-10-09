/**
 * Freehand strokes (007 FR-025 Draw, research R6): Ramer–Douglas–Peucker at 0.5 pt in page space,
 * at most 5,000 points per stroke, coordinates rounded to 0.01 pt.
 */
import type { Point } from "./geometry";

export const EPSILON = 0.5;
export const MAX_POINTS = 5000;

function distance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}

function rdp(points: Point[], epsilon: number): Point[] {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let max = 0;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const d = distance(points[i], points[from], points[to]);
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (at >= 0 && max > epsilon) {
      keep[at] = 1;
      stack.push([from, at], [at, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Every n-th point so that at most `max` remain, keeping both endpoints. */
function sample(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

export function simplify(points: Point[]): Point[] {
  // bound the work on pathological input (RDP is quadratic in the worst case)
  const out = points.length <= 2 ? points : sample(rdp(sample(points, 2 * MAX_POINTS), EPSILON), MAX_POINTS);
  return out.map(([x, y]) => [round(x), round(y)]);
}
