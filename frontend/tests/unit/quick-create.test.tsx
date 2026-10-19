import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rangeLabel } from "@/features/calendar/draft";
import { QuickCreate } from "@/features/calendar/QuickCreateForm";
import { toClassForm, toEventForm, initialQuickValue, validateQuick, isDirty } from "@/features/calendar/quickCreate";
import { useDraft } from "@/features/calendar/useDraft";
import { json, mockFetch, on, problem, renderRoutes, type Handler } from "./test-utils";

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const DESKTOP = "(min-width: 1024px)";
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: query === DESKTOP,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.unstubAllGlobals();
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

const YEAR = { id: "y1", name: "2026", position: 0, version: 1 };
const SEMESTER = { id: "s1", yearId: "y1", name: "Fall 2026", startDate: null, endDate: "2027-01-10", version: 1 };
const COURSE = { id: "c1", semesterId: "s1", name: "CS 201", defaultColor: "green", version: 1, reservedNameConflict: false };
const TREE = [{ year: YEAR, semesters: [{ semester: SEMESTER, courses: [COURSE], eventCount: 0 }] }];

const COLUMNS = [
  { id: "col-todo", name: "To do", position: 0, countsAsDone: false, taskCount: 0, version: 1 },
  { id: "col-doing", name: "Doing", position: 1, countsAsDone: false, taskCount: 0, version: 1 },
];

/** Tuesday 6 October 2026, 10:00–11:00 (a click draft). */
const DRAFT = { date: "2026-10-06", startMin: 600, endMin: 660 };

function Harness() {
  const drafts = useDraft();
  const { start } = drafts;
  useEffect(() => {
    start(DRAFT.date, { startMin: DRAFT.startMin, endMin: DRAFT.endMin }, "click", "open");
  }, [start]);
  const d = drafts.state.draft;
  return (
    <>
      <button type="button">Outside</button>
      <p data-testid="draft">{d ? `${d.date} ${rangeLabel(d)}` : "none"}</p>
      {d && <div data-draft style={{ height: 40 }} />}
      <QuickCreate drafts={drafts} />
    </>
  );
}

function StateEcho() {
  const location = useLocation();
  return <pre data-testid="state">{JSON.stringify(location.state)}</pre>;
}

function setup(prefs: Record<string, unknown> = {}, ...extra: Handler[]) {
  const fetch = mockFetch(
    ...extra,
    on("GET", "/api/v1/preferences", () => json(prefs)),
    on("PATCH", "/api/v1/preferences", (_u, init) => json({ ...prefs, ...JSON.parse(String(init.body)) })),
    on("GET", "/api/v1/course-tree", () => json(TREE)),
    on("GET", "/api/v1/years", () => json([YEAR])),
    on("GET", "/api/v1/semesters", () => json([SEMESTER])),
    on("GET", "/api/v1/courses", () => json([COURSE])),
    on("GET", "/api/v1/task-columns", () => json(COLUMNS)),
  );
  const utils = renderRoutes(
    [
      { path: "/calendar", element: <Harness /> },
      { path: "/classes/new", element: <StateEcho /> },
      { path: "/events/new", element: <StateEcho /> },
    ],
    "/calendar",
  );
  return { ...utils, fetch, user: userEvent.setup() };
}

const form = () => screen.findByRole("form", { name: "New entry" });
const saveButton = () => screen.getByRole("button", { name: "Save" });
const bodyOf = (calls: { url: URL; init: RequestInit }[], method: string, path: string) =>
  JSON.parse(String(calls.find((c) => c.init.method === method && c.url.pathname === path)!.init.body));

describe("quick form values (pure)", () => {
  it("weekly repeats on the draft's weekday and ends with the semester, like the full form", () => {
    const v = { ...initialQuickValue(DRAFT, "event"), title: "Study group", repeat: "weekly" as const };
    expect(toEventForm(v).recurrence).toMatchObject({ freq: "weekly", byWeekday: ["TU"], endKind: "semester_end" });
    expect(validateQuick(v, { known: true, endDate: null }).repeat).toMatch(/no end date/);
    expect(validateQuick(v, { known: true, endDate: "2027-01-10" }).repeat).toBeUndefined();
  });

  it("an existing course brings its year, semester and colour; the title stays empty", () => {
    const courses = [{ id: "c1", name: "CS 201", label: "CS 201 · Fall 2026 2026", yearId: "y1", yearName: "2026", semesterId: "s1", semesterName: "Fall 2026", color: "green" as const }];
    const v = { ...initialQuickValue(DRAFT, "class"), course: { kind: "existing" as const, id: "c1", name: "CS 201" } };
    const full = toClassForm(v, courses);
    expect(full.hierarchy.semester).toEqual({ kind: "existing", id: "s1", name: "Fall 2026" });
    expect(full.color).toBe("green");
    expect(full.title).toBe("");
    expect(full.recurrence.freq).toBe("none");
  });

  it("only the type switch does not count as entering something", () => {
    const initial = initialQuickValue(DRAFT, "class");
    expect(isDirty({ ...initial, type: "event" }, initial)).toBe(false);
    expect(isDirty({ ...initial, location: "G032" }, initial)).toBe(true);
  });
});

describe("QuickCreateForm (009 US6)", () => {
  it("starts as Class the first time and requires a course", async () => {
    const { user } = setup();
    await form();
    expect(screen.getByRole("radio", { name: "Class" })).toHaveAttribute("aria-checked", "true");
    expect(saveButton()).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Course" })).toHaveFocus());
    await user.click(screen.getByRole("combobox", { name: "Course" }));
    await user.click(await screen.findByRole("option", { name: /CS 201 · Fall 2026/ }));
    expect(saveButton()).toBeEnabled();
  });

  it("a new course name also asks for year and semester", async () => {
    const { user } = setup();
    await form();
    await user.click(screen.getByRole("combobox", { name: "Course" }));
    await user.keyboard("MATH 101");
    await user.click(await screen.findByRole("option", { name: "Create “MATH 101”" }));
    expect(screen.getByRole("combobox", { name: "Semester" })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Year" }));
    await user.click(await screen.findByRole("option", { name: "2026" }));
    await user.click(screen.getByRole("combobox", { name: "Semester" }));
    await user.click(await screen.findByRole("option", { name: "Fall 2026" }));
    expect(saveButton()).toBeEnabled();
  });

  it("opens with the type used last, the last semester preselected, and saves an event with Undo", async () => {
    const made = { lineageId: "E1", semesterId: "s1", version: 1, created: { lineageId: "E1", yearId: null, semesterId: null, courseId: null } };
    const { user, fetch } = setup(
      { quickCreateType: "event", lastSemesterId: "s1" },
      on("POST", "/api/v1/events", () => json(made, 201)),
      on("POST", "/api/v1/creations/undo", () => new Response(null, { status: 204 })),
    );
    await form();
    expect(screen.getByRole("radio", { name: "Event" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("combobox", { name: "Semester" })).toHaveTextContent("Fall 2026");
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());
    expect(saveButton()).toBeDisabled();
    await user.type(screen.getByLabelText("Title"), "Study group");
    await user.click(screen.getByRole("combobox", { name: "Repeat" }));
    await user.click(await screen.findByRole("option", { name: "Weekly on Tuesday" }));
    await user.click(saveButton());

    await waitFor(() => expect(screen.getByTestId("draft")).toHaveTextContent("none"));
    expect(bodyOf(fetch.calls, "POST", "/api/v1/events")).toEqual({
      title: "Study group", semester: { id: "s1" }, startDate: "2026-10-06", startTime: "10:00", endTime: "11:00",
      location: null, color: "blue", links: [],
      recurrence: { freq: "weekly", intervalWeeks: 1, byWeekday: ["TU"], end: { kind: "semester_end" } },
    });
    await waitFor(() => expect(bodyOf(fetch.calls, "PATCH", "/api/v1/preferences")).toEqual({ quickCreateType: "event", lastSemesterId: "s1" }));
    expect(toastMock).toHaveBeenCalledWith("Event created", expect.objectContaining({ duration: 10_000 }));
    const options = toastMock.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(options.action.label).toBe("Undo");
    await act(async () => options.action.onClick());
    await waitFor(() => expect(bodyOf(fetch.calls, "POST", "/api/v1/creations/undo")).toEqual({ created: made.created, version: 1 }));
  });

  it("Add to kanban (012 FR-035): off by default; on sends addToBoard with the chosen column", async () => {
    const made = { lineageId: "E1", semesterId: "s1", version: 1, created: { lineageId: "E1", yearId: null, semesterId: null, courseId: null } };
    const { user, fetch } = setup(
      { quickCreateType: "event", lastSemesterId: "s1" },
      on("POST", "/api/v1/events", () => json(made, 201)),
    );
    await form();
    await user.type(screen.getByLabelText("Title"), "Exam");
    const toggle = await screen.findByRole("switch", { name: "Add to kanban" });
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    expect(screen.getByRole("combobox", { name: "Column" })).toHaveTextContent("To do");
    expect(screen.queryByText("Only the first occurrence is added to the board")).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Column" }));
    await user.click(await screen.findByRole("option", { name: "Doing" }));
    await user.click(screen.getByRole("combobox", { name: "Repeat" }));
    await user.click(await screen.findByRole("option", { name: "Weekly on Tuesday" }));
    expect(screen.getByText("Only the first occurrence is added to the board")).toBeInTheDocument();
    await user.click(saveButton());
    await waitFor(() => expect(screen.getByTestId("draft")).toHaveTextContent("none"));
    expect(bodyOf(fetch.calls, "POST", "/api/v1/events")).toMatchObject({ title: "Exam", addToBoard: { columnId: "col-doing" } });
  });

  it("saves a class on an existing course with the course's colour and no title", async () => {
    const { user, fetch } = setup({}, on("POST", "/api/v1/classes", () => json({ lineageId: "L1", version: 1, created: { lineageId: "L1" } }, 201)));
    await form();
    await user.click(screen.getByRole("combobox", { name: "Course" }));
    await user.click(await screen.findByRole("option", { name: /CS 201 · Fall 2026/ }));
    await user.click(saveButton());
    await waitFor(() => expect(screen.getByTestId("draft")).toHaveTextContent("none"));
    expect(bodyOf(fetch.calls, "POST", "/api/v1/classes")).toEqual({
      course: { id: "c1" }, title: null, startDate: "2026-10-06", startTime: "10:00", endTime: "11:00",
      location: null, color: "green", links: [], recurrence: { freq: "none" },
    });
    expect(toastMock).toHaveBeenCalledWith("Class created", expect.anything());
  });

  it("time edits move the draft live; an end not after the start disables Save", async () => {
    const { user } = setup({ quickCreateType: "event", lastSemesterId: "s1" });
    await form();
    await user.type(screen.getByLabelText("Title"), "Exam");
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "12:15" } });
    expect(screen.getByTestId("draft")).toHaveTextContent("2026-10-06 10:00 – 12:15");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-08" } });
    expect(screen.getByTestId("draft")).toHaveTextContent("2026-10-08 10:00 – 12:15");
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "09:00" } });
    expect(screen.getByText("End must be after start")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("keeps the form and its values when saving fails, and Save retries", async () => {
    let attempts = 0;
    const { user } = setup(
      { quickCreateType: "event", lastSemesterId: "s1" },
      on("POST", "/api/v1/events", () =>
        ++attempts === 1 ? problem(500, "internal", "Something went wrong on the server.") : json({ lineageId: "E1", semesterId: "s1", version: 1, created: { lineageId: "E1" } }, 201),
      ),
    );
    await form();
    await user.type(screen.getByLabelText("Title"), "Study group");
    await user.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on the server.");
    expect(screen.getByLabelText("Title")).toHaveValue("Study group");
    expect(screen.getByTestId("draft")).not.toHaveTextContent("none");
    await user.click(saveButton());
    await waitFor(() => expect(screen.getByTestId("draft")).toHaveTextContent("none"));
    expect(attempts).toBe(2);
  });

  it("More options opens the full form with every value entered so far", async () => {
    const { user, router } = setup({ quickCreateType: "event", lastSemesterId: "s1" });
    await form();
    await user.type(screen.getByLabelText("Title"), "Study group");
    await user.type(screen.getByLabelText("Location (optional)"), "FENS L045");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await user.type(screen.getByLabelText("Link 1 address"), "https://example.edu");
    await user.click(screen.getByRole("button", { name: "More options" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/events/new"));
    const { prefill } = JSON.parse(screen.getByTestId("state").textContent!);
    expect(prefill).toMatchObject({
      title: "Study group", startDate: "2026-10-06", startTime: "10:00", endTime: "11:00", location: "FENS L045",
      links: [{ label: "", url: "https://example.edu" }],
      hierarchy: { semester: { kind: "existing", id: "s1" }, year: { kind: "existing", id: "y1" } },
      recurrence: { freq: "none" },
    });
  });

  it("Custom… repeat opens the full class form with a weekly rule", async () => {
    const { user, router } = setup();
    await form();
    await user.click(screen.getByRole("combobox", { name: "Repeat" }));
    await user.click(await screen.findByRole("option", { name: "Custom…" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/classes/new"));
    const { prefill } = JSON.parse(screen.getByTestId("state").textContent!);
    expect(prefill).toMatchObject({ startDate: "2026-10-06", recurrence: { freq: "weekly", byWeekday: ["TU"] } });
  });

  it("Escape and Cancel discard the draft", async () => {
    const { user } = setup();
    await form();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("draft")).toHaveTextContent("none");
    expect(screen.queryByRole("form", { name: "New entry" })).not.toBeInTheDocument();
  });

  it("Escape discards", async () => {
    const { user } = setup();
    await form();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Course" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("draft")).toHaveTextContent("none");
  });

  it("a click outside discards an empty form but not one with something entered", async () => {
    const { user } = setup({ quickCreateType: "event", lastSemesterId: "s1" });
    const f = await form();
    await new Promise((r) => setTimeout(r, 20)); // Radix listens for outside presses after mount
    await user.type(within(f).getByLabelText("Title"), "Study group");
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.getByRole("form", { name: "New entry" })).toBeInTheDocument();
    await user.clear(within(f).getByLabelText("Title"));
    await user.click(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(screen.getByTestId("draft")).toHaveTextContent("none"));
  });
});
