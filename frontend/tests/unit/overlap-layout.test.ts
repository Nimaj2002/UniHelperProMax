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

  it("classes and events share the layout: four overlapping entries get four columns (009 FR-008)", () => {
    // keys as the calendar uses them: class sessions and event occurrences in one list
    const r = layoutOverlaps([ev("class-a", 600, 690), ev("event-b", 630, 720), ev("event-c", 640, 700), ev("class-d", 650, 680)]);
    expect([...r.values()].every((p) => p.columns === 4)).toBe(true);
    expect(new Set([...r.values()].map((p) => p.column))).toEqual(new Set([0, 1, 2, 3]));
  });

  it("touching class and event share a column", () => {
    const r = layoutOverlaps([ev("class-a", 600, 690), ev("event-b", 690, 750)]);
    expect(r.get("class-a")).toEqual({ column: 0, columns: 1 });
    expect(r.get("event-b")).toEqual({ column: 0, columns: 1 });
  });
});

describe("layoutOverlaps with a draft (009 FR-028)", () => {
  it("places the draft beside overlapping entries without moving the others further", () => {
    const r = layoutOverlaps([ev("a", 600, 690), ev("__draft__", 630, 720), ev("c", 780, 840)]);
    expect(r.get("a")).toEqual({ column: 0, columns: 2 });
    expect(r.get("__draft__")).toEqual({ column: 1, columns: 2 });
    expect(r.get("c")).toEqual({ column: 0, columns: 1 }); // not overlapping: full width
  });

  it("a draft that overlaps nothing takes the full width", () => {
    expect(layoutOverlaps([ev("a", 600, 660), ev("__draft__", 660, 720)]).get("__draft__")).toEqual({ column: 0, columns: 1 });
  });
});
