import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { Session } from "@/features/classes/api";
import { SessionChip, sessionPhase } from "@/features/sessions/SessionChip";
import { renderWithProviders } from "./test-utils";

function session(over: Partial<Session> = {}): Session {
  return {
    key: "l1:2026-10-09",
    lineageId: "l1",
    seriesId: "s1",
    seriesVersion: 1,
    courseId: "c1",
    courseName: "CS 406",
    title: "Parallel processing",
    date: "2026-10-09",
    start: "2026-10-09T09:40:00Z",
    end: "2026-10-09T11:30:00Z",
    location: "FENS G032",
    color: "teal",
    links: [{ label: "Slides", url: "https://example.org/slides" }],
    recurrenceSummary: "",
    isException: false,
    exceptionVersion: null,
    status: "upcoming",
    scheduled: true,
    ...over,
  } as Session;
}

afterEach(() => vi.useRealTimers());

describe("SessionChip (008 FR-016)", () => {
  it("shows the date and time with an Upcoming marker, and the details on demand", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T12:00:00Z"), shouldAdvanceTime: true });
    const { container } = renderWithProviders(<SessionChip session={session()} />);
    const chip = screen.getByRole("button", { name: /^Session details: Friday 9 October 2026, \d\d:\d\d–\d\d:\d\d, upcoming$/ });
    expect(chip).toHaveTextContent(/^Fri 9 Oct/);
    expect(chip).toHaveTextContent("Upcoming");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(chip);
    const details = await screen.findByRole("dialog");
    expect(details).toHaveTextContent("CS 406");
    expect(screen.getByRole("link", { name: "CS 406" })).toHaveAttribute("href", "/courses/c1");
    expect(details).toHaveTextContent("Parallel processing");
    expect(details).toHaveTextContent("FENS G032");
    const link = screen.getByRole("link", { name: /Slides/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(details).toHaveTextContent("Upcoming");
  });

  it("omits an empty location and links and has no Upcoming marker for past sessions", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-20T12:00:00Z"), shouldAdvanceTime: true });
    renderWithProviders(<SessionChip session={session({ location: null, links: [], scheduled: false })} />);
    const chip = screen.getByRole("button", { name: /^Session details: Friday 9 October 2026, [^,]+$/ });
    expect(chip).not.toHaveTextContent("Upcoming");
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(chip);
    const details = await screen.findByRole("dialog");
    expect(details).not.toHaveTextContent("Location");
    expect(details).not.toHaveTextContent("Links");
    expect(details).toHaveTextContent("Past");
    expect(details).toHaveTextContent("No longer scheduled");
  });

  it("knows upcoming, in-progress and past", () => {
    const s = { start: "2026-10-09T09:40:00Z", end: "2026-10-09T11:30:00Z" };
    expect(sessionPhase(s, Date.parse("2026-10-09T09:00:00Z"))).toBe("upcoming");
    expect(sessionPhase(s, Date.parse("2026-10-09T10:00:00Z"))).toBe("in-progress");
    expect(sessionPhase(s, Date.parse("2026-10-09T12:00:00Z"))).toBe("past");
  });
});
