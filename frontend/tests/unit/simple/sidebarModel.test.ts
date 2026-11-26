import { describe, expect, it } from "vitest";
import { GENERAL_ENTRIES, isCurrent, SESSION_BACK_ENTRIES } from "@/app/simple/sidebarModel";

describe("Simple sidebar model (026)", () => {
  it("orders general entries Calendar, Courses, Tasks, with no Graph or Events", () => {
    expect(GENERAL_ENTRIES.map((e) => e.id)).toEqual(["calendar", "courses", "tasks"]);
  });
  it("keeps the calendar and a way back to Courses inside a session", () => {
    expect(SESSION_BACK_ENTRIES.map((e) => e.id)).toEqual(["calendar"]);
  });
  it("marks the entry that owns a route", () => {
    const [calendar, courses, tasks] = GENERAL_ENTRIES;
    expect(isCurrent(calendar, "/")).toBe(true);
    expect(isCurrent(calendar, "/calendar/week/2026-01-05")).toBe(true);
    expect(isCurrent(courses, "/courses/abc")).toBe(true);
    expect(isCurrent(tasks, "/courses/abc")).toBe(false);
  });
});
