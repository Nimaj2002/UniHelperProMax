import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { UiModeSwitch } from "@/app/simple/UiModeSwitch";
import { useUiMode } from "@/app/uiMode";
import { UiChoiceHost } from "@/features/tour/UiChoiceHost";
import { CoursesGridPage } from "@/features/courses/CoursesGridPage";
import { json, mockFetch, on, renderRoutes } from "../test-utils";

let prefs: Record<string, unknown>;
beforeEach(() => {
  prefs = { editorMode: "live" };
  localStorage.clear();
});

function api(...extra: Parameters<typeof on>[]) {
  return mockFetch(
    on("GET", "/api/v1/preferences", () => json(prefs)),
    on("PATCH", "/api/v1/preferences", (_u, init) => {
      prefs = { ...prefs, ...JSON.parse(String(init.body)) };
      return json(prefs);
    }),
    ...extra.map((a) => on(...a)),
  );
}

function Probe() {
  const { mode } = useUiMode();
  return <p data-testid="mode">{mode}</p>;
}

describe("interface choice", () => {
  it("defaults to Ultimate and switches to Simple through the radio group", async () => {
    api();
    const { container } = renderRoutes([{ path: "/", element: <><Probe /><UiModeSwitch /></> }], "/");
    expect(screen.getByTestId("mode")).toHaveTextContent("ultimate");
    await userEvent.click(await screen.findByRole("radio", { name: /Simple/ }));
    await waitFor(() => expect(prefs.uiMode).toBe("simple"));
    expect(screen.getByTestId("mode")).toHaveTextContent("simple");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reverts when the save fails", async () => {
    mockFetch(
      on("GET", "/api/v1/preferences", () => json(prefs)),
      on("PATCH", "/api/v1/preferences", () => json({ title: "boom" }, 500)),
    );
    renderRoutes([{ path: "/", element: <><Probe /><UiModeSwitch /></> }], "/");
    await userEvent.click(await screen.findByRole("radio", { name: /Simple/ }));
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("ultimate"));
  });
});

const tree = [
  {
    year: { id: "y1", name: "2025-26" },
    semesters: [
      { semester: { id: "s1", name: "Fall" }, eventCount: 0, courses: [{ id: "c1", name: "Algorithms", defaultColor: "blue" }, { id: "c2", name: "Biology", defaultColor: "green" }] },
      { semester: { id: "s2", name: "Spring" }, eventCount: 0, courses: [{ id: "c3", name: "Calculus", defaultColor: "red" }] },
    ],
  },
];

describe("Courses grid", () => {
  it("shows a box per course, filters by semester and search, and links to the course", async () => {
    prefs = { uiMode: "simple" };
    api(["GET", "/api/v1/course-tree", () => json(tree)]);
    const { container } = renderRoutes([{ path: "/courses", element: <CoursesGridPage /> }], "/courses");
    expect(await screen.findByRole("link", { name: /Algorithms/ })).toHaveAttribute("href", "/courses/c1");
    expect(screen.getAllByRole("listitem")).toHaveLength(3); // all semesters
    await userEvent.selectOptions(screen.getByLabelText("Semester"), "s2");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText("Semester"), "all");
    await userEvent.type(screen.getByLabelText("Search courses"), "bio");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an empty state with no courses", async () => {
    prefs = { uiMode: "simple" };
    api(["GET", "/api/v1/course-tree", () => json([])]);
    renderRoutes([{ path: "/courses", element: <CoursesGridPage /> }], "/courses");
    expect(await screen.findByText(/No courses yet/)).toBeInTheDocument();
  });
});

describe("first-sign-in choice (Yuii)", () => {
  it("asks once, saves the pick, and stays away once chosen", async () => {
    api();
    renderRoutes([{ path: "/", element: <UiChoiceHost /> }], "/");
    await userEvent.click(await screen.findByRole("button", { name: /Simple/ }));
    await waitFor(() => expect(prefs.uiMode).toBe("simple"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not ask when a mode is already saved", async () => {
    prefs = { uiMode: "ultimate" };
    api();
    renderRoutes([{ path: "/", element: <UiChoiceHost /> }], "/");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
