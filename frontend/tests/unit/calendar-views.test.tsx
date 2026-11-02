import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EventBlock } from "@/features/calendar/EventBlock";
import { describe, expect, it, vi } from "vitest";
import { sessionLabel } from "@/features/calendar/EventBlock";
import { MonthView } from "@/features/calendar/MonthView";
import { shiftPeriod } from "@/features/calendar/navigation";
import type { Session } from "@/features/classes/api";
import { formatRangeLabel } from "@/lib/dates";

/** The app's providers the calendar needs (tooltips on entries, links, 020: tracked time). */
function Shell({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function event(i: number, date: string, start = "14:00", end = "15:30"): Session {
  return {
    ...session(i, date, start, end), kind: "event", seriesId: null, courseId: null, courseName: null,
    title: "AI Seminar", location: "FENS L045", recurrenceSummary: "Does not repeat",
  };
}

function session(i: number, date: string, start = "10:00", end = "11:00"): Session {
  return {
    key: `L${i}:${date}`, kind: "class", lineageId: `L${i}`, seriesId: `S${i}`, seriesVersion: 1, courseId: "c1", semesterId: "sem1",
    courseName: `Course ${i}`, title: null, date, start: `${date}T${start}:00+03:00`,
    end: `${date}T${end}:00+03:00`, location: null, color: "blue", links: [],
    recurrenceSummary: "Weekly", isException: false, exceptionVersion: null, status: "upcoming", scheduled: true,
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

describe("event blocks (009 FR-007, FR-008)", () => {
  it("names an event with an 'Event:' prefix and shows marker, title, time and location", () => {
    render(
      <Shell>
        <EventBlock session={event(1, "2026-10-15")} />
      </Shell>,
    );
    const block = screen.getByRole("button", { name: "Event: AI Seminar, Thursday 15 October, 14:00 to 15:30, FENS L045" });
    expect(block).toHaveAttribute("data-kind", "event");
    expect(within(block).getByTestId("event-marker")).toBeInTheDocument();
    expect(block).toHaveTextContent("AI Seminar");
    expect(block).toHaveTextContent("14:00–15:30");
    expect(block).toHaveTextContent("FENS L045");
    expect(block.style.borderLeftStyle).toBe("dashed"); // the marker is not colour alone
  });

  it("keeps classes unchanged: no marker, course name first", () => {
    render(
      <Shell>
        <EventBlock session={{ ...session(2, "2026-10-15"), courseName: "CS 201", title: "Lecture" }} />
      </Shell>,
    );
    const block = screen.getByRole("button", { name: /^CS 201 Lecture, Thursday 15 October/ });
    expect(within(block).queryByTestId("event-marker")).toBeNull();
    expect(block).toHaveAttribute("data-kind", "class");
  });

  it("shows the full title in a tooltip on keyboard focus", async () => {
    const long = { ...event(3, "2026-10-15"), title: "A very long seminar title that does not fit in the block" };
    render(
      <Shell>
        <EventBlock session={long} compact />
      </Shell>,
    );
    await userEvent.setup().tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Event: A very long seminar title that does not fit in the block");
  });

  it("month view lists events in '+N more' with their marker", async () => {
    const day = "2026-10-07";
    const sessions = [session(1, day, "08:00", "09:00"), session(2, day, "09:00", "10:00"), event(3, day)];
    render(
      <Shell>
        <MonthView date="2026-10-15" sessions={sessions} tz="UTC" maxChips={1} />
      </Shell>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Show 2 more sessions on Wednesday 7 October" }));
    const dialog = await screen.findByRole("dialog", { name: "Wednesday 7 October" });
    expect(within(dialog).getByRole("button", { name: /^Event: AI Seminar/ })).toBeInTheDocument();
  });
});

describe("MonthView", () => {
  it("shows '+N more' for crowded days and reveals all sessions", async () => {
    const day = "2026-10-07";
    const sessions = Array.from({ length: 6 }, (_, i) => session(i, day, `0${i + 1}:00`, `0${i + 1}:30`));
    render(
      <Shell>
        <MonthView date="2026-10-15" sessions={sessions} tz="UTC" maxChips={2} />
      </Shell>,
    );
    const more = screen.getByRole("button", { name: "Show 4 more sessions on Wednesday 7 October" });
    expect(more).toHaveTextContent("+4 more");
    await userEvent.setup().click(more);
    const dialog = await screen.findByRole("dialog", { name: "Wednesday 7 October" });
    expect(within(dialog).getAllByRole("button", { name: /^Course \d/ })).toHaveLength(6);
  });

  it("renders a 6×7 Monday-first grid", () => {
    render(
      <Shell>
        <MonthView date="2026-10-15" sessions={[]} tz="UTC" maxChips={3} />
      </Shell>,
    );
    const cells = screen.getAllByRole("gridcell");
    expect(cells).toHaveLength(42);
    expect(within(cells[0]).getByText("28")).toBeInTheDocument(); // Mon 28 Sep
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("creates a 09:00–10:00 draft when empty day space is clicked (009 FR-029)", async () => {
    const onCreateDraft = vi.fn();
    const day = "2026-10-07";
    const { rerender } = render(
      <Shell>
        <MonthView date="2026-10-15" sessions={[session(1, day)]} tz="UTC" maxChips={3} onCreateDraft={onCreateDraft} />
      </Shell>,
    );
    const user = userEvent.setup();
    const cell = screen.getByRole("gridcell", { name: "Wednesday 7 October" });
    await user.click(within(cell).getByRole("button", { name: /^Course 1/ })); // a chip: its own action
    await user.click(within(cell).getByRole("button", { name: "Open Wednesday 7 October in day view" }));
    expect(onCreateDraft).not.toHaveBeenCalled();
    await user.click(cell);
    expect(onCreateDraft).toHaveBeenCalledWith(day);

    rerender(
      <Shell>
        <MonthView
          date="2026-10-15"
          sessions={[]}
          tz="UTC"
          maxChips={3}
          onCreateDraft={onCreateDraft}
          draft={{ id: 1, date: day, startMin: 540, endMin: 600, origin: "month" }}
        />
      </Shell>,
    );
    const chip = cell.querySelector("[data-draft]");
    expect(chip).toHaveTextContent("09:00 – 10:00 New entry");
    expect(chip).toHaveAttribute("aria-hidden");
  });
});
