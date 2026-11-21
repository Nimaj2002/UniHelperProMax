import { describe, expect, it } from "vitest";
import { addWindowAt, clampEnd, clampStart, gaps, isUntouched, keptMs, moveWindow, type Range } from "@/features/media-editor/tools/trim/windows";

const W = (a: number, b: number): Range => ({ startMs: a, endMs: b });
const TOTAL = 100_000;

describe("keep-windows (025 FR-006a/b)", () => {
  it("adds nothing while the playhead is inside a window", () => {
    for (const t of [20_000, 25_000, 30_000]) {
      expect("problem" in addWindowAt([W(20_000, 30_000)], t, TOTAL)).toBe(true);
    }
  });
  it("starts at the playhead to the right of a window and runs right", () => {
    const r = addWindowAt([W(10_000, 20_000)], 40_000, TOTAL);
    expect(r).toEqual({ ranges: [W(10_000, 20_000), W(40_000, 50_000)], index: 1 });
  });
  it("does the same to the left of a window, stopped by the window it meets", () => {
    const r = addWindowAt([W(60_000, 70_000)], 55_000, TOTAL);
    expect(r).toEqual({ ranges: [W(55_000, 60_000), W(60_000, 70_000)], index: 0 });
    const free = addWindowAt([W(60_000, 70_000)], 20_000, TOTAL);
    expect(free).toEqual({ ranges: [W(20_000, 30_000), W(60_000, 70_000)], index: 0 });
  });
  it("is stopped by the end of the audio, then runs left when the end leaves no room", () => {
    expect(addWindowAt([W(1000, 2000)], 95_000, TOTAL)).toEqual({ ranges: [W(1000, 2000), W(95_000, 100_000)], index: 1 });
    expect(addWindowAt([W(1000, 2000)], 99_950, TOTAL)).toEqual({ ranges: [W(1000, 2000), W(89_950, 99_950)], index: 1 });
  });
  it("refuses when no room is left, and at the limit", () => {
    expect("problem" in addWindowAt([W(0, 10_000), W(10_050, 20_000)], 10_020, TOTAL)).toBe(true);
    const many = Array.from({ length: 20 }, (_, i) => W(i * 4000, i * 4000 + 1000));
    expect("problem" in addWindowAt(many, 90_000, TOTAL)).toBe(true);
  });
  it("never lets windows collide when an edge is dragged or typed", () => {
    const rs = [W(10_000, 20_000), W(30_000, 40_000)];
    expect(clampStart(rs, 1, 15_000)).toBe(20_000); // stopped at the neighbour's end
    expect(clampEnd(rs, 0, 35_000, TOTAL)).toBe(30_000); // stopped at the next start
    expect(clampStart(rs, 0, -5)).toBe(0);
    expect(clampEnd(rs, 1, 500_000, TOTAL)).toBe(TOTAL);
    expect(clampStart(rs, 0, 19_990)).toBe(19_900); // keeps 0.1 s
  });
  it("moves a window as a whole, between its neighbours", () => {
    const rs = [W(10_000, 20_000), W(30_000, 40_000), W(60_000, 70_000)];
    expect(moveWindow(rs, 1, 55_000, TOTAL)[1]).toEqual(W(50_000, 60_000));
    expect(moveWindow(rs, 1, 0, TOTAL)[1]).toEqual(W(20_000, 30_000));
    expect(moveWindow(rs, 2, 99_000, TOTAL)[2]).toEqual(W(90_000, 100_000));
  });
  it("lists the cut parts", () => {
    expect(gaps([W(10, 20), W(30, 40)], 50)).toEqual([W(0, 10), W(20, 30), W(40, 50)]);
    expect(gaps([W(0, 50)], 50)).toEqual([]);
  });
  it("totals what is kept and knows an untouched selection", () => {
    expect(keptMs([W(0, 10), W(30, 45)])).toBe(25);
    expect(isUntouched([W(0, 50)], 50)).toBe(true);
    expect(isUntouched([W(0, 50), W(60, 70)], 100)).toBe(false);
  });
});
