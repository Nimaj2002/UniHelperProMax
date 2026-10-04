import { describe, expect, it } from "vitest";
import { layoutOverlaps } from "@/features/calendar/layoutOverlaps";

const ev = (key: string, start: number, end: number) => ({ key, start, end });

describe("layoutOverlaps", () => {
  it("non-overlapping sessions get full width", () => {
    const r = layoutOverlaps([ev("a", 60, 120), ev("b", 120, 180), ev("c", 300, 360)]);
    expect(r.get("a")).toEqual({ column: 0, columns: 1 });
    expect(r.get("b")).toEqual({ column: 0, columns: 1 }); // touching is not overlapping
    expect(r.get("c")).toEqual({ column: 0, columns: 1 });
  });

  it("two overlapping sessions split in halves", () => {
    const r = layoutOverlaps([ev("a", 60, 120), ev("b", 90, 150)]);
    expect(r.get("a")).toEqual({ column: 0, columns: 2 });
    expect(r.get("b")).toEqual({ column: 1, columns: 2 });
  });

  it("three mutually overlapping sessions split in thirds", () => {
    const r = layoutOverlaps([ev("a", 60, 180), ev("b", 70, 170), ev("c", 80, 160)]);
    expect([...r.values()].map((x) => x.columns)).toEqual([3, 3, 3]);
    expect(new Set([...r.values()].map((x) => x.column))).toEqual(new Set([0, 1, 2]));
  });

  it("chained overlaps share one cluster and reuse freed columns", () => {
    // a overlaps b, b overlaps c, a and c do not overlap → 2 columns, c reuses column 0
    const r = layoutOverlaps([ev("a", 0, 60), ev("b", 30, 90), ev("c", 60, 120)]);
    expect(r.get("a")).toEqual({ column: 0, columns: 2 });
    expect(r.get("b")).toEqual({ column: 1, columns: 2 });
    expect(r.get("c")).toEqual({ column: 0, columns: 2 });
  });

  it("separate clusters are independent", () => {
    const r = layoutOverlaps([ev("a", 0, 60), ev("b", 30, 90), ev("c", 200, 260)]);
    expect(r.get("c")).toEqual({ column: 0, columns: 1 });
  });
});
