import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Waveform } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/app/shell/AppShell";
import { useLayout, useRightCard } from "@/app/shell/layout";
import { FocusModeButton } from "@/app/shell/MainBarControls";
import { registerActivity } from "@/app/shell/registry";
import { json, mockFetch, on, renderRoutes } from "./test-utils";

const setOpenSpy = vi.fn();

/** A page with a session panel whose open state it owns, like the session workspace. */
function Page() {
  const [open, setOpen] = useState(true);
  const card = useMemo(
    () => ({
      label: "Session panel",
      header: <h2>Recordings</h2>,
      body: <p>recordings</p>,
      rail: { label: "Session panel rail", reopenLabel: "Show session panel", items: [{ id: "recordings", icon: Waveform, name: "Recordings", onActivate: () => {} }] },
      open,
      setOpen: (o: boolean) => {
        setOpenSpy(o);
        setOpen(o);
      },
    }),
    [open],
  );
  useRightCard(card);
  const { toggleRight } = useLayout();
  return (
    <div>
      <textarea aria-label="Note" />
      <button type="button" onClick={toggleRight}>
        toggle audio
      </button>
      <FocusModeButton />
    </div>
  );
}

function wide(matches: boolean) {
  // the session panel docks only where it fits next to a 480 px main card (014 FR-008)
  vi.stubGlobal("innerWidth", matches ? 1366 : 1000);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("1100") ? matches : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function render() {
  mockFetch(on("GET", /.*/, () => json({ id: "u1", username: "student", role: "owner", timezone: "UTC" })));
  return renderRoutes([{ element: <AppShell />, children: [{ path: "*", element: <Page /> }] }], "/");
}

const side = () => screen.queryByRole("complementary", { name: "Side panel" });
const audio = () => screen.queryByRole("complementary", { name: "Session panel" });
const audioRail = () => screen.queryByRole("navigation", { name: "Session panel rail" });
const rail = () => screen.queryByRole("button", { name: "Show side panel" });

beforeEach(() => {
  localStorage.clear();
  setOpenSpy.mockClear();
  wide(true);
});
afterEach(() => vi.unstubAllGlobals());

describe("focus mode (008 US4)", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("hides both side cards and restores left closed=%s, audio closed=%s exactly", async (leftClosed, audioClosed) => {
    localStorage.setItem("uh.panel.collapsed", JSON.stringify(leftClosed));
    render();
    await screen.findByRole("button", { name: "Enter focus mode" });
    if (audioClosed) fireEvent.click(screen.getByRole("button", { name: "toggle audio" }));
    setOpenSpy.mockClear();
    const stored = localStorage.getItem("uh.panel.collapsed");

    fireEvent.keyDown(document.body, { key: "\\" });
    expect(side()).toBeNull();
    expect(audio()).toBeNull();
    expect(screen.getByRole("button", { name: "Leave focus mode" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Leave focus mode" }));
    expect(side()).not.toBeNull();
    expect(!!rail()).toBe(leftClosed);
    expect(!!audio()).toBe(!audioClosed);
    // focus mode never writes the remembered states
    expect(localStorage.getItem("uh.panel.collapsed")).toBe(stored);
    expect(setOpenSpy).not.toHaveBeenCalled();
  });

  it("ignores \\ with modifiers and while typing", async () => {
    render();
    await screen.findByRole("button", { name: "Enter focus mode" });
    for (const mod of ["altKey", "ctrlKey", "metaKey"]) fireEvent.keyDown(document.body, { key: "\\", [mod]: true });
    expect(side()).not.toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox", { name: "Note" }));
    await user.keyboard("a\\");
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("a\\");
    expect(side()).not.toBeNull();
  });

  it("[ and the audio toggle leave focus mode first, then toggle", async () => {
    render();
    await screen.findByRole("button", { name: "Enter focus mode" });
    fireEvent.keyDown(document.body, { key: "\\" });
    fireEvent.keyDown(document.body, { key: "[" });
    expect(screen.getByRole("button", { name: "Enter focus mode" })).toBeInTheDocument();
    expect(rail()).not.toBeNull(); // left card toggled closed after focus mode ended
    expect(audio()).not.toBeNull();

    fireEvent.keyDown(document.body, { key: "\\" });
    fireEvent.click(screen.getByRole("button", { name: "toggle audio" }));
    expect(screen.getByRole("button", { name: "Enter focus mode" })).toBeInTheDocument();
    expect(audio()).toBeNull();
  });

  it("is not remembered across a reload", async () => {
    const first = render();
    await screen.findByRole("button", { name: "Enter focus mode" });
    fireEvent.keyDown(document.body, { key: "\\" });
    first.unmount();
    render();
    await screen.findByRole("button", { name: "Enter focus mode" });
    expect(side()).not.toBeNull();
  });

  it("hides the session panel and its rail but keeps the activity pills (014 FR-011)", async () => {
    const unregister = registerActivity({ id: "test-pill", component: () => <div role="region" aria-label="Recording">Recording 00:05</div> });
    try {
      render();
      await screen.findByRole("button", { name: "Enter focus mode" });
      const pill = () => screen.queryByRole("region", { name: "Recording" });
      expect(pill()).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "toggle audio" }));
      expect(audio()).toBeNull();
      expect(audioRail()).not.toBeNull();

      fireEvent.keyDown(document.body, { key: "\\" });
      expect(audio()).toBeNull();
      expect(audioRail()).toBeNull();
      expect(pill()).not.toBeNull();
      expect(screen.getByRole("region", { name: "Activity" })).toContainElement(pill());

      fireEvent.keyDown(document.body, { key: "\\" });
      expect(audioRail()).not.toBeNull();
    } finally {
      unregister();
    }
  });

  it("starts with both side cards closed on narrow windows", async () => {
    wide(false);
    render();
    await screen.findByRole("button", { name: "Enter focus mode" });
    await act(async () => {});
    expect(side()).toBeNull();
    expect(audio()).toBeNull();
    // the session panel's rail stays on the right edge (014 FR-010)
    expect(audioRail()).not.toBeNull();
  });
});
