import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CoursePanel, CourseSearch } from "@/features/courses/CoursePanel";
import type { YearNode } from "@/features/courses/api";
import { json, mockFetch, on, renderRoutes } from "./test-utils";

afterEach(() => vi.unstubAllGlobals());

// SC-005: results within 0.5 s of typing for up to 200 courses; filtering is local.
it("filters 200 courses within 500 ms of the last keystroke", { timeout: 30_000 }, async () => {
  const tree: YearNode[] = Array.from({ length: 2 }, (_, y) => ({
    year: { id: `y${y}`, name: `${2026 - y}`, folderName: `${2026 - y}`, position: y, version: 1 },
    semesters: Array.from({ length: 5 }, (_, s) => ({
      semester: { id: `s${y}-${s}`, yearId: `y${y}`, name: `Term ${s + 1}`, folderName: `Term ${s + 1}`, startDate: null, endDate: null, version: 1 },
      courses: Array.from({ length: 20 }, (_, c) => ({
        id: `c${y}-${s}-${c}`, semesterId: `s${y}-${s}`, name: `Course ${y}${s}${String(c).padStart(2, "0")}`,
        folderName: "x", defaultColor: "blue", version: 1, reservedNameConflict: false,
      })),
      eventCount: 0,
    })),
  }));
  const { calls } = mockFetch(on("GET", "/api/v1/course-tree", () => json(tree)));
  renderRoutes([{ path: "/", element: <><CourseSearch /><CoursePanel /></> }], "/");
  await screen.findByText("Course 0000");
  // course links, plus (009) one "Events" link per semester
  expect(screen.getAllByRole("link", { name: /^Course / })).toHaveLength(200);
  expect(screen.getAllByRole("link", { name: /^Events/ })).toHaveLength(10);
  const user = userEvent.setup({ delay: null });
  const requestsBefore = calls.length;
  await user.type(screen.getByRole("searchbox"), "course 13");
  const t0 = performance.now();
  await screen.findByRole("link", { name: "Course 1300" });
  const elapsed = performance.now() - t0;
  expect(screen.getAllByRole("link", { name: /^Course / })).toHaveLength(20);
  expect(screen.getAllByRole("link", { name: /^Events/ })).toHaveLength(1);
  expect(elapsed).toBeLessThan(500);
  expect(calls.length).toBe(requestsBefore);
});
