import { describe, expect, it } from "vitest";
import { MAX_POINTS, simplify } from "@/features/documents/reader/annotations/simplify";

describe("stroke simplification (Ramer–Douglas–Peucker, 0.5 pt)", () => {
  it("keeps the endpoints and drops points on a straight line", () => {
    const line: [number, number][] = Array.from({ length: 50 }, (_, i) => [i, i * 2]);
    expect(simplify(line)).toEqual([[0, 0], [49, 98]]);
  });

  it("keeps corners and removes jitter under 0.5 pt", () => {
    const pts: [number, number][] = [[0, 0], [5, 0.2], [10, 0], [10, 5], [10.3, 10], [10, 15]];
    expect(simplify(pts)).toEqual([[0, 0], [10, 0], [10, 15]]);
  });

  it("keeps short strokes and caps long ones at 5,000 points", () => {
    expect(simplify([[1, 1]])).toEqual([[1, 1]]);
    const zigzag: [number, number][] = Array.from({ length: 20000 }, (_, i) => [i, i % 2 ? 10 : 0]);
    const out = simplify(zigzag);
    expect(out.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([19999, 10]);
  });

  it("rounds to 0.01 pt to keep files small", () => {
    expect(simplify([[0.123456, 1.987654], [10.5555, 3.33333]])).toEqual([[0.12, 1.99], [10.56, 3.33]]);
  });
});
