import { describe, expect, it } from "vitest";
import { computeColumnIndex, computeTarget, fullIndex, originOf, slots, type Placed } from "@/features/tasks/board/dropTarget";

const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
const columns: Placed[] = [
  { id: "a", rect: rect(0, 0, 280, 600) },
  { id: "b", rect: rect(288, 0, 280, 600) },
];
// three 60 px cards in column a at y 50, 120, 190 (midpoints 80, 150, 220)
const cards = {
  a: ["1", "2", "3"].map((id, i) => ({ id, rect: rect(8, 50 + i * 70, 264, 60) })),
  b: [] as Placed[],
};

describe("computeTarget", () => {
  it("is null outside every column", () => {
    expect(computeTarget(600, 100, columns, cards, "x")).toBeNull();
    expect(computeTarget(100, 700, columns, cards, "x")).toBeNull();
  });
  it("finds the first card whose midpoint is below the pointer", () => {
    expect(computeTarget(100, 10, columns, cards, "x")).toEqual({ columnId: "a", index: 0 });
    expect(computeTarget(100, 100, columns, cards, "x")).toEqual({ columnId: "a", index: 1 });
    expect(computeTarget(100, 400, columns, cards, "x")).toEqual({ columnId: "a", index: 3 });
  });
  it("measures against the cards left after removing the dragged one", () => {
    expect(computeTarget(100, 100, columns, cards, "1")).toEqual({ columnId: "a", index: 0 });
    expect(computeTarget(100, 400, columns, cards, "2")).toEqual({ columnId: "a", index: 2 });
  });
  it("an empty column takes index 0", () => {
    expect(computeTarget(300, 100, columns, cards, "1")).toEqual({ columnId: "b", index: 0 });
  });
});

describe("computeColumnIndex", () => {
  const three: Placed[] = [...columns, { id: "c", rect: rect(576, 0, 280, 600) }];
  it("uses the other columns' horizontal midpoints", () => {
    expect(computeColumnIndex(10, three, "c")).toBe(0);
    expect(computeColumnIndex(500, three, "a")).toBe(1);
    expect(computeColumnIndex(900, three, "a")).toBe(2);
  });
});

describe("helpers", () => {
  it("originOf", () => {
    expect(originOf([{ id: "a", taskIds: ["1", "2"] }, { id: "b", taskIds: ["3"] }], "3")).toEqual({ columnId: "b", index: 0 });
    expect(originOf([], "3")).toBeNull();
  });
  it("fullIndex maps visible indexes onto the full column", () => {
    const full = ["1", "h1", "2", "h2", "3"];
    expect(fullIndex(full, full, 2, "x")).toBe(2);
    expect(fullIndex(full, ["1", "2", "3"], 1, "x")).toBe(2);
    expect(fullIndex(full, ["1", "2", "3"], 3, "x")).toBe(5);
    expect(fullIndex(full, [], 0, "x")).toBe(5);
    // moving within the column: the moved card is not counted
    expect(fullIndex(["1", "2", "3"], ["1", "2", "3"], 1, "1")).toBe(1);
  });
  it("slots: pointer drag removes the item and shows the ghost", () => {
    expect(slots(["1", "2", "3"], "2", false, 0)).toEqual([{ kind: "ghost" }, { kind: "item", id: "1" }, { kind: "item", id: "3" }]);
    expect(slots(["1", "3"], "2", false, null).map((s) => s.kind)).toEqual(["item", "item"]);
  });
  it("slots: keyboard keeps the item in place and ghosts the destination", () => {
    const ids = (s: ReturnType<typeof slots>) => s.map((x) => (x.kind === "ghost" ? "G" : x.id)).join("");
    expect(ids(slots(["1", "2", "3"], "1", true, 1))).toBe("12G3");
    expect(ids(slots(["1", "2", "3"], "3", true, 0))).toBe("G123");
    expect(ids(slots(["1", "2", "3"], "2", true, 1))).toBe("123");
    expect(ids(slots(["1", "2"], null, false, 2))).toBe("12G");
  });
});
