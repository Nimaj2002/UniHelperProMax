import { describe, expect, it } from "vitest";
import type { YearNode } from "@/features/courses/api";
import { semesterWeekOf } from "@/features/calendar/semesterWeek";

const sem = (id: string, name: string, startDate: string | null, endDate: string | null = null) => ({
  semester: { id, yearId: "y", name, folderName: name, startDate, endDate, version: 1 },
  courses: [],
  eventCount: 0,
});
const tree = (...semesters: ReturnType<typeof sem>[]): YearNode[] => [
  { year: { id: "y", name: "2026", folderName: "2026", position: 0, version: 1 }, semesters },
];

describe("semesterWeekOf", () => {
  // 2026-09-30 is a Wednesday; its week runs Mon 09-28 .. Sun 10-04.
  const fall = tree(sem("f", "Fall", "2026-09-30", "2027-01-10"));

  it("counts the start date's Monday-based week as week 1", () => {
    expect(semesterWeekOf(fall, "2026-09-28")).toBeNull(); // before start
    expect(semesterWeekOf(fall, "2026-09-30")).toEqual({ week: 1, semesterName: "Fall" });
    expect(semesterWeekOf(fall, "2026-10-04")?.week).toBe(1);
    expect(semesterWeekOf(fall, "2026-10-05")?.week).toBe(2);
    expect(semesterWeekOf(fall, "2026-10-16")?.week).toBe(3);
  });

  it("is empty outside every dated semester", () => {
    expect(semesterWeekOf(fall, "2027-01-11")).toBeNull();
    expect(semesterWeekOf(tree(sem("x", "Undated", null)), "2026-10-16")).toBeNull();
  });

  it("treats a missing end as open-ended and prefers the latest start on overlap", () => {
    const t = tree(sem("a", "Fall", "2026-09-01"), sem("b", "Winter", "2026-10-05", "2026-10-30"));
    expect(semesterWeekOf(t, "2026-10-01")?.semesterName).toBe("Fall");
    expect(semesterWeekOf(t, "2026-10-16")).toEqual({ week: 2, semesterName: "Winter" });
  });
});
