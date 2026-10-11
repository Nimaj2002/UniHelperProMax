import { describe, expect, it } from "vitest";
import { keyRangeMinutes, moveRange, SLOTS_PER_DAY, type KeyRange } from "@/features/calendar/draft";

const at10: KeyRange = { day: 1, slot: 40, len: 1 }; // 10:00

describe("keyboard slot ranges (009 US7, research R13)", () => {
  it("moves by 15 minutes with ↑/↓", () => {
    expect(moveRange(at10, "ArrowDown", false, 7)).toEqual({ day: 1, slot: 41, len: 1 });
    expect(moveRange(at10, "ArrowUp", false, 7)).toEqual({ day: 1, slot: 39, len: 1 });
    expect(moveRange({ day: 0, slot: 0, len: 1 }, "ArrowUp", false, 7).slot).toBe(0);
    expect(moveRange({ day: 0, slot: SLOTS_PER_DAY - 4, len: 4 }, "ArrowDown", false, 7).slot).toBe(SLOTS_PER_DAY - 4);
  });

  it("moves by a day with ←/→ (week view), inside the visible days", () => {
    expect(moveRange(at10, "ArrowRight", false, 7).day).toBe(2);
    expect(moveRange(at10, "ArrowLeft", false, 7).day).toBe(0);
    expect(moveRange({ ...at10, day: 0 }, "ArrowLeft", false, 7).day).toBe(0);
    expect(moveRange({ ...at10, day: 0 }, "ArrowRight", false, 1).day).toBe(0); // day view
  });

  it("extends and shortens with Shift+↓/↑, never below 15 minutes", () => {
    let r = at10;
    for (let i = 0; i < 3; i++) r = moveRange(r, "ArrowDown", true, 7);
    expect(keyRangeMinutes(r)).toEqual({ startMin: 600, endMin: 660 });
    r = moveRange(r, "ArrowUp", true, 7);
    expect(r.len).toBe(3);
    expect(moveRange(at10, "ArrowUp", true, 7).len).toBe(1);
    expect(moveRange({ day: 0, slot: SLOTS_PER_DAY - 1, len: 1 }, "ArrowDown", true, 7).len).toBe(1); // ends at 24:00
  });

  it("keeps the length while moving the range", () => {
    expect(moveRange({ day: 1, slot: 40, len: 4 }, "ArrowDown", false, 7)).toEqual({ day: 1, slot: 41, len: 4 });
  });
});
