import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SessionTimeline } from "@/features/sessions/SessionTimeline";
import { entry } from "./timeline-fixtures";

afterEach(() => vi.useRealTimers());

it("flips a session from Upcoming to normal exactly at its start, without reload (FR-027)", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-07T09:59:30+03:00"));
  render(
    <MemoryRouter>
      <SessionTimeline entries={[entry("2026-10-07", { status: "upcoming" })]} variant="page" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link")).toHaveTextContent("Upcoming");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(29_000);
  });
  expect(screen.getByRole("link")).toHaveTextContent("Upcoming");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_100);
  });
  expect(screen.getByRole("link")).not.toHaveTextContent("Upcoming");
});
