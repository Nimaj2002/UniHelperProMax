import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTour } from "@/features/tour/store";
import { TourButton } from "@/features/tour/TourButton";
import { TourHost } from "@/features/tour/TourHost";
import { json, mockFetch, on, renderWithProviders } from "../test-utils";

// the runner needs the whole shell; the host's job is only deciding when to start it
vi.mock("@/features/tour/TourRunner", () => ({
  TourRunner: ({ request }: { request: { chapter: string; resume?: boolean; firstRun?: boolean } }) => (
    <p data-testid="runner">{`${request.chapter}${request.resume ? " resume" : ""}${request.firstRun ? " first" : ""}`}</p>
  ),
}));

afterEach(() => {
  closeTour();
  vi.unstubAllGlobals();
});

const prefs = (tour: unknown) => mockFetch(on("GET", "/api/v1/preferences", () => json({ tour })));

describe("TourHost (023 R13)", () => {
  it("starts on first run", async () => {
    prefs({ status: "not_seen", chapter: null });
    renderWithProviders(<TourHost />);
    expect(await screen.findByTestId("runner")).toHaveTextContent("welcome first");
  });

  it("offers to continue an interrupted tour", async () => {
    prefs({ status: "in_progress", chapter: "first_note" });
    renderWithProviders(<TourHost />);
    expect(await screen.findByTestId("runner")).toHaveTextContent("first_note resume");
  });

  it.each(["completed", "skipped"])("stays away once %s", async (status) => {
    const { calls } = prefs({ status, chapter: null });
    renderWithProviders(<TourHost />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("runner")).toBeNull();
  });

  it("does not start on the sign-in page", async () => {
    const { calls } = prefs({ status: "not_seen", chapter: null });
    renderWithProviders(<TourHost />, "/login");
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("runner")).toBeNull();
  });
});

describe("TourButton (023 FR-020)", () => {
  it("replays from the start or jumps to a chapter", async () => {
    prefs({ status: "completed", chapter: null });
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <TourButton />
        <TourHost />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Tour with Yuii" }));
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual([
      "Start from the beginning",
      "Hello & overview",
      "Your first course",
      "Your first note",
      "PDFs & recording",
      "AI chat & AI teacher",
      "Settings",
      "Goodbye",
    ]);
    // keyboard: the menu items are reachable with the arrow keys
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Start from the beginning" })).toHaveFocus();
    await user.click(screen.getByRole("menuitem", { name: "AI chat & AI teacher" }));
    expect(await screen.findByTestId("runner")).toHaveTextContent(/^ai$/);
  });
});
