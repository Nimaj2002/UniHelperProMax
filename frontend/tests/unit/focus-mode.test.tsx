import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/app/shell/AppShell";
import { useLayout, useRightCard } from "@/app/shell/layout";
import { FocusModeButton } from "@/app/shell/MainBarControls";
import { json, mockFetch, on, renderRoutes } from "./test-utils";

const setOpenSpy = vi.fn();

/** A page with an audio card whose open state it owns, like the session workspace. */
function Page() {
  const [open, setOpen] = useState(true);
  const card = useMemo(
    () => ({
      header: <h2>Audio</h2>,
      body: <p>recordings</p>,
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
const audio = () => screen.queryByRole("complementary", { name: "Audio" });
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

  it("starts with both side cards closed on narrow windows", async () => {
    wide(false);
    render();
    await screen.findByRole("button", { name: "Enter focus mode" });
    await act(async () => {});
    expect(side()).toBeNull();
    expect(audio()).toBeNull();
  });
});
