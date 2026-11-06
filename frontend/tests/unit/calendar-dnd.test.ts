import { describe, expect, it } from "vitest";
import { initialClassForm } from "@/features/classes/ClassForm";
import { applyMove, dropStartMin } from "@/features/calendar/dnd";

const weekly = (byWeekday: ("MO" | "WE" | "FR")[]) => ({
  ...initialClassForm({ date: "2026-09-28", start: "10:00", end: "11:30" }),
  recurrence: { freq: "weekly" as const, intervalWeeks: 1, byWeekday, endKind: "semester_end" as const, untilDate: "", count: "14" },
});
const to = { date: "2026-10-02", start: "12:00", end: "13:30" };

describe("calendar drag and drop", () => {
  it("moves a single session to the dropped date and time", () => {
    const v = applyMove(weekly(["MO", "WE"]), to, false);
    expect([v.startDate, v.startTime, v.endTime]).toEqual(["2026-10-02", "12:00", "13:30"]);
    expect(v.recurrence.byWeekday).toEqual(["MO", "WE"]);
  });

  it("moves the weekday of a series and keeps its start date", () => {
    const v = applyMove(weekly(["MO", "WE"]), to, true);
    expect(v.startDate).toBe("2026-09-28");
    expect(v.recurrence.byWeekday).toEqual(["FR", "WE"]);
    expect(applyMove(weekly(["MO", "FR"]), to, true).recurrence.byWeekday).toEqual(["FR"]);
  });

  it("snaps the drop to 15 minutes and keeps it inside the day", () => {
    const column = { getBoundingClientRect: () => ({ top: 100 }) } as HTMLElement;
    expect(dropStartMin(100 + 12 * 48 + 5, column, 0, 90)).toBe(12 * 60);
    expect(dropStartMin(100 + 12 * 48, column, 30, 90)).toBe(11 * 60 + 30); // grabbed 30 min down
    expect(dropStartMin(100 + 23 * 48, column, 0, 90)).toBe(24 * 60 - 15 - 90);
    expect(dropStartMin(0, column, 0, 90)).toBe(0);
  });
});
