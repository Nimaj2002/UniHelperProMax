import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { CoursePanel } from "@/features/courses/CoursePanel";
import type { YearNode } from "@/features/courses/api";
import { json, mockFetch, on, problem, renderRoutes } from "./test-utils";

afterEach(() => vi.unstubAllGlobals());

let n = 0;
const id = () => `id${++n}`;
function year(name: string, position: number, semesters: [string, string | null, string[]][]): YearNode {
  const yid = id();
  return {
    year: { id: yid, name, folderName: name, position, version: 1 },
    semesters: semesters.map(([sname, start, courses]) => {
      const sid = id();
      return {
        semester: { id: sid, yearId: yid, name: sname, folderName: sname, startDate: start, endDate: null, version: 1 },
        courses: courses.map((c) => ({ id: id(), semesterId: sid, name: c, folderName: c, defaultColor: "blue", version: 1 })),
      };
    }),
  };
}

function tree() {
  return [
    year("2026", 0, [["Fall 2026", "2026-09-21", ["CS 201", "Math 203"]], ["Spring 2026", "2026-02-01", ["Physics"]]]),
    year("2025", 1, [["Fall 2025", "2025-09-21", ["Intro CS"]]]),
    year("2024", 2, [["Fall 2024", null, ["History"]]]),
  ];
}

function render(t = tree(), orderResponse?: (body: unknown) => Response) {
  let served = t; // behaves like the backend: a successful reorder changes later reads
  const calls = mockFetch(
    on("GET", "/api/v1/course-tree", () => json(served)),
    on("PUT", "/api/v1/years/order", (_u, init) => {
      const body = JSON.parse(String(init.body)) as { yearIds: string[] };
      const r = orderResponse ? orderResponse(body) : json([]);
      if (r.ok) served = body.yearIds.map((yid) => t.find((n) => n.year.id === yid)!);
      return r;
    }),
  );
  const utils = renderRoutes(
    [
      { path: "/", element: <CoursePanel /> },
      { path: "/courses/:id", element: <p>course page</p> },
    ],
    "/",
  );
  return { ...utils, calls };
}

const yearNames = () =>
  screen.getAllByRole("button", { expanded: true }).filter((b) => b.hasAttribute("data-year-toggle")).map((b) => b.textContent);

describe("CoursePanel", () => {
  it("groups years in position order and semesters most recent first, with no axe violations", async () => {
    const { container } = render();
    await screen.findByText("CS 201");
    expect(yearNames()).toEqual(["2026", "2025", "2024"]);
    const y2026 = screen.getByRole("button", { name: "2026" }).closest("li")!;
    const semesters = within(y2026)
      .getAllByRole("button", { expanded: true })
      .filter((b) => !b.hasAttribute("data-year-toggle"))
      .map((b) => b.textContent);
    expect(semesters).toEqual(["Fall 2026", "Spring 2026"]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("filters case-insensitively as you type, with empty state and clear", async () => {
    const { calls } = render();
    const user = userEvent.setup();
    await screen.findByText("CS 201");
    const before = calls.calls.length;
    await user.type(screen.getByRole("searchbox", { name: "Search courses" }), "cs 2");
    expect(screen.getByRole("link", { name: "CS 201" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Intro CS" })).toBeNull();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "INTRO");
    expect(screen.getByRole("link", { name: "Intro CS" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Physics" })).toBeNull();
    expect(calls.calls.length).toBe(before); // filtering is local: no request per keystroke
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByRole("status")).toHaveTextContent("No courses match “zzz”.");
    await user.click(screen.getByRole("button", { name: "Show all courses" }));
    expect(screen.getByRole("link", { name: "Physics" })).toBeInTheDocument();
  });

  it("'/' focuses the search and keyboard selection opens the course", async () => {
    render();
    const user = userEvent.setup();
    await screen.findByText("CS 201");
    await user.keyboard("/");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    screen.getByRole("link", { name: "CS 201" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("course page")).toBeInTheDocument();
  });

  it("reorders years with Alt+Arrow keys (optimistic), keeps focus and announces", async () => {
    const t = tree();
    const sent: unknown[] = [];
    render(t, (body) => { sent.push(body); return json([]); });
    const user = userEvent.setup();
    const y2025 = await screen.findByRole("button", { name: "2025" });
    y2025.focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await waitFor(() => expect(yearNames()).toEqual(["2025", "2026", "2024"]));
    await waitFor(() => expect(sent).toEqual([{ yearIds: [t[1].year.id, t[0].year.id, t[2].year.id] }]));
    await waitFor(() => expect(screen.getByRole("button", { name: "2025" })).toHaveFocus());
    expect(screen.getByText("2025 moved to position 1 of 3")).toBeInTheDocument();
  });

  it("reorders with the menu and rolls back when the server refuses", async () => {
    const t = tree();
    render(t, () => problem(409, "order_mismatch"));
    const user = userEvent.setup();
    await screen.findByText("CS 201");
    await user.click(screen.getByRole("button", { name: "Actions for 2026" }));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));
    await waitFor(() => expect(yearNames()).toEqual(["2026", "2025", "2024"])); // rolled back
  });

  it("reorders by drag and drop", async () => {
    const t = tree();
    const sent: unknown[] = [];
    render(t, (body) => { sent.push(body); return json([]); });
    await screen.findByText("CS 201");
    const handles = document.querySelectorAll("[draggable='true']");
    const target = screen.getByRole("button", { name: "2026" }).closest("li")!;
    fireEvent.dragStart(handles[2], { dataTransfer: { setData() {}, effectAllowed: "" } });
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    await waitFor(() => expect(sent).toEqual([{ yearIds: [t[2].year.id, t[0].year.id, t[1].year.id] }]));
  });
});
