import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { SessionTimeline } from "@/features/sessions/SessionTimeline";
import { entry } from "./timeline-fixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-06T12:00:00+03:00"));
});
afterEach(() => vi.useRealTimers());

describe("SessionTimeline", () => {
  it("groups by month, marks upcoming and unscheduled, shows note counts", async () => {
    const entries = [
      entry("2026-09-28", { noteCount: 2 }),
      entry("2026-09-30", { scheduled: false, noteCount: 1 }),
      entry("2026-10-05"),
      entry("2026-10-07"),
    ];
    const { container } = render(
      <MemoryRouter>
        <SessionTimeline entries={entries} variant="page" />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["September 2026", "October 2026"]);
    const sep = screen.getByRole("region", { name: "September 2026" });
    expect(within(sep).getByRole("link", { name: /^28 Mon/ })).toHaveTextContent("2 notes");
    expect(within(sep).getByRole("link", { name: /^30 Wed/ })).toHaveTextContent("No longer scheduled");
    const oct = screen.getByRole("region", { name: "October 2026" });
    expect(within(oct).getByRole("link", { name: /^5 Mon/ })).not.toHaveTextContent("Upcoming");
    expect(within(oct).getByRole("link", { name: /^7 Wed/ })).toHaveTextContent("Upcoming");
    expect(within(oct).getByRole("link", { name: /^7 Wed/ })).toHaveAttribute("href", "/courses/c1/sessions/L%3A2026-10-07");
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("highlights the active session in the compact variant", () => {
    render(
      <MemoryRouter>
        <SessionTimeline entries={[entry("2026-09-28"), entry("2026-09-30")]} variant="compact" activeKey="L:2026-09-30" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /^30 Wed/ })).toHaveAttribute("aria-current", "page");
  });
});
