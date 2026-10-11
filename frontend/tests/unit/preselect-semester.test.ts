import { describe, expect, it } from "vitest";
import type { YearNode } from "@/features/courses/api";
import { openContextFrom, preselectSemester } from "@/features/events/usePreselectedSemester";
import { initialEventForm, validateEventForm } from "@/features/events/EventForm";

const sem = (id: string, name: string, courses: string[]) => ({
  semester: { id, yearId: "y1", name, folderName: name, startDate: null, endDate: null, version: 1 },
  courses: courses.map((c) => ({ id: c, semesterId: id, name: c, folderName: c, defaultColor: "blue" as const, version: 1, reservedNameConflict: false })),
  eventCount: 0,
});
const tree: YearNode[] = [
  { year: { id: "y1", name: "2026", folderName: "2026", position: 0, version: 1 }, semesters: [sem("s1", "Fall 2026", ["c1"]), sem("s2", "Spring 2026", ["c2"])] },
];

describe("semester preselection (009 FR-004)", () => {
  it("prefers the open course's semester, then the open semester, then the last used", () => {
    expect(preselectSemester(tree, { courseId: "c2" }, "s1")?.semesterName).toBe("Spring 2026");
    expect(preselectSemester(tree, { semesterId: "s2" }, "s1")?.semesterId).toBe("s2");
    expect(preselectSemester(tree, undefined, "s1")).toEqual({ yearId: "y1", yearName: "2026", semesterId: "s1", semesterName: "Fall 2026" });
  });

  it("ignores a last semester that no longer exists, and starts empty without history", () => {
    expect(preselectSemester(tree, undefined, "gone")).toBeNull();
    expect(preselectSemester(tree, undefined, null)).toBeNull();
    expect(preselectSemester(tree, { courseId: "gone" }, null)).toBeNull();
  });

  it("reads what is open from the path", () => {
    expect(openContextFrom("/courses/c1")).toEqual({ courseId: "c1" });
    expect(openContextFrom("/courses/c1/sessions/L%3A2026-10-15")).toEqual({ courseId: "c1" });
    expect(openContextFrom("/semesters/s2/events")).toEqual({ semesterId: "s2" });
    expect(openContextFrom("/calendar/week/2026-10-15")).toBeUndefined();
  });
});

describe("event form validation (009 US1 scenario 3)", () => {
  const known = { known: true, endDate: "2027-01-10" };
  it("needs a title, a semester and an end after the start", () => {
    const e = validateEventForm(initialEventForm({ startDate: "2026-10-15", startTime: "14:00", endTime: "14:00" }), known);
    expect(e).toMatchObject({ title: "Enter a title.", year: "Choose or create a year.", semester: "Choose or create a semester.", endTime: "End time must be after the start time." });
  });

  it("defaults to blue and no repetition", () => {
    const v = initialEventForm();
    expect(v.color).toBe("blue");
    expect(v.recurrence.freq).toBe("none");
  });
});
