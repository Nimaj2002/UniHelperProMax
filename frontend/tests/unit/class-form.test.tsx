import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ClassForm, classPayload, initialClassForm, sessionEditPayload, validateClassForm } from "@/features/classes/ClassForm";
import { ApiError } from "@/lib/api";
import { json, mockFetch, on, renderWithProviders } from "./test-utils";

afterEach(() => vi.unstubAllGlobals());

const noData = () =>
  mockFetch(
    on("GET", "/api/v1/years", () => json([])),
    on("GET", "/api/v1/semesters", () => json([])),
    on("GET", "/api/v1/courses", () => json([])),
  );

async function createInline(user: ReturnType<typeof userEvent.setup>, label: string, name: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.keyboard(name);
  await user.click(await screen.findByRole("option", { name: `Create “${name}”` }));
}

describe("ClassForm", () => {
  it("builds a nested inline-create payload", () => {
    const v = initialClassForm({ date: "2026-09-28", start: "10:00", end: "11:30" });
    v.hierarchy = {
      year: { kind: "new", name: "2026" },
      semester: { kind: "new", name: "Fall 2026" },
      course: { kind: "new", name: "CS 201" },
      semesterStart: "",
      semesterEnd: "2027-01-10",
    };
    v.recurrence = { ...v.recurrence, byWeekday: ["MO", "WE"] };
    expect(classPayload(v)).toMatchObject({
      course: {
        new: {
          name: "CS 201",
          semester: { new: { name: "Fall 2026", endDate: "2027-01-10", startDate: null, year: { new: { name: "2026" } } } },
        },
      },
      startDate: "2026-09-28",
      recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
    });
  });

  it("sends only the new date when a single session moves to another day", () => {
    const initial = initialClassForm({ date: "2026-09-28", start: "10:00", end: "11:30" });
    const moved = { ...initial, startDate: "2026-10-02" };
    expect(sessionEditPayload(moved, "edit-this", initial)).toEqual({ date: "2026-10-02" });
    expect(validateClassForm({ ...initial, startDate: "" }, { known: true, endDate: null }, "edit-this").startDate).toBeTruthy();
  });

  it("blocks end time before start and semester-end without an end date", () => {
    const v = initialClassForm({ date: "2026-09-28", start: "10:00", end: "09:00" });
    v.hierarchy = { year: { kind: "new", name: "2026" }, semester: { kind: "new", name: "T" },
      course: { kind: "new", name: "C" }, semesterStart: "", semesterEnd: "" };
    v.recurrence = { ...v.recurrence, byWeekday: ["MO"] };
    const e = validateClassForm(v, { known: true, endDate: null });
    expect(e.endTime).toMatch(/after the start/);
    expect(e.endKind).toMatch(/no end date/);
  });

  it("disables 'when the semester ends' for a new semester without an end date", async () => {
    noData();
    const user = userEvent.setup();
    renderWithProviders(
      <ClassForm initial={initialClassForm({ date: "2026-09-28" })} submitLabel="Save class" pending={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    await createInline(user, "Year", "2026");
    await createInline(user, "Semester", "Fall 2026");
    expect(screen.getByRole("radio", { name: "When the semester ends" })).toBeDisabled();
    await user.type(screen.getByLabelText(/Semester ends/), "2027-01-10");
    expect(screen.getByRole("radio", { name: "When the semester ends" })).toBeEnabled();
  });

  it("keeps all input and shows server field errors on 422", async () => {
    noData();
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError(422, "invalid_time_range", "End time must be after the start time.", undefined, [
        { field: "/endTime", code: "invalid_time_range", message: "End time must be after the start time." },
      ]),
    );
    const { container } = renderWithProviders(
      <ClassForm initial={initialClassForm({ date: "2026-09-28", start: "10:00", end: "11:00" })} submitLabel="Save class" pending={false} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    await createInline(user, "Year", "2026");
    await createInline(user, "Semester", "Fall 2026");
    await user.type(screen.getByLabelText(/Semester ends/), "2027-01-10");
    await createInline(user, "Course", "CS 201");
    await user.type(screen.getByLabelText("Location (optional)"), "FENS G032");
    await user.click(screen.getByRole("button", { name: "Monday" }));
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Save class" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(await screen.findByText("End time must be after the start time.")).toBeInTheDocument();
    expect(screen.getByLabelText("Location (optional)")).toHaveValue("FENS G032");
    expect(screen.getByRole("combobox", { name: "Course" })).toHaveTextContent("CS 201 (new)");
    expect(await axe(container)).toHaveNoViolations();
  });
});
