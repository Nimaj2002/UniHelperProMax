import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { sessionLabel } from "@/features/calendar/EventBlock";
import { MonthView } from "@/features/calendar/MonthView";
import { shiftPeriod } from "@/features/calendar/navigation";
import type { Session } from "@/features/classes/api";
import { formatRangeLabel } from "@/lib/dates";

function session(i: number, date: string, start = "10:00", end = "11:00"): Session {
  return {
    key: `L${i}:${date}`, lineageId: `L${i}`, seriesId: `S${i}`, seriesVersion: 1, courseId: "c1",
    courseName: `Course ${i}`, title: null, date, start: `${date}T${start}:00+03:00`,
    end: `${date}T${end}:00+03:00`, location: null, color: "blue", links: [],
    recurrenceSummary: "Weekly", isException: false, exceptionVersion: null, status: "upcoming",
  };
}

describe("range labels", () => {
  it("formats day, week and month ranges", () => {
    expect(formatRangeLabel("day", "2026-10-05")).toBe("Monday, 5 October 2026");
    expect(formatRangeLabel("week", "2026-10-07")).toBe("5 – 11 October 2026");
    expect(formatRangeLabel("week", "2026-09-30")).toBe("28 Sep – 4 Oct 2026");
    expect(formatRangeLabel("week", "2026-12-30")).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(formatRangeLabel("month", "2026-10-15")).toBe("October 2026");
  });
});

describe("period navigation", () => {
  it("moves by one day, week or month", () => {
    expect(shiftPeriod("day", "2026-10-05", 1)).toBe("2026-10-06");
    expect(shiftPeriod("day", "2026-10-05", -1)).toBe("2026-10-04");
    expect(shiftPeriod("week", "2026-10-05", 1)).toBe("2026-10-12");
    expect(shiftPeriod("week", "2026-10-05", -1)).toBe("2026-09-28");
    expect(shiftPeriod("month", "2026-10-31", 1)).toBe("2026-11-30");
    expect(shiftPeriod("month", "2026-10-15", -1)).toBe("2026-09-15");
  });
});

describe("event accessible name", () => {
  it("reads course, title, day, time and location", () => {
    const s = { ...session(1, "2026-10-05", "10:00", "11:30"), courseName: "CS 201", title: "Lecture", location: "FENS G032" };
    expect(sessionLabel(s)).toBe("CS 201 Lecture, Monday 5 October, 10:00 to 11:30, FENS G032");
  });
});

describe("MonthView", () => {
  it("shows '+N more' for crowded days and reveals all sessions", async () => {
    const day = "2026-10-07";
    const sessions = Array.from({ length: 6 }, (_, i) => session(i, day, `0${i + 1}:00`, `0${i + 1}:30`));
    render(
      <MemoryRouter>
        <MonthView date="2026-10-15" sessions={sessions} tz="UTC" maxChips={2} />
      </MemoryRouter>,
    );
    const more = screen.getByRole("button", { name: "Show 4 more sessions on Wednesday 7 October" });
    expect(more).toHaveTextContent("+4 more");
    await userEvent.setup().click(more);
    const dialog = await screen.findByRole("dialog", { name: "Wednesday 7 October" });
    expect(within(dialog).getAllByRole("button", { name: /^Course \d/ })).toHaveLength(6);
  });

  it("renders a 6×7 Monday-first grid", () => {
    render(
      <MemoryRouter>
        <MonthView date="2026-10-15" sessions={[]} tz="UTC" maxChips={3} />
      </MemoryRouter>,
    );
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(42);
    expect(within(cells[0]).getByText("28")).toBeInTheDocument(); // Mon 28 Sep
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});
