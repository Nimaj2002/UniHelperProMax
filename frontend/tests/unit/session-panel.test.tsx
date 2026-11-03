import { act, fireEvent, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_PANEL_KEY,
  SessionPanel,
  useSessionPanelLayout,
  type SessionPanelLayout,
} from "@/features/sessions/SessionPanel";
import { registerChatSection } from "@/features/sessions/workspace-panels";
import { renderWithProviders } from "./test-utils";

let latest: SessionPanelLayout | null = null;
const report = (l: SessionPanelLayout) => void (latest = l);

/** The workspace's use of the panel: its layout hook (seeded by the preference) and its body. */
function Harness({ seed }: { seed?: boolean }) {
  const { layout, setOpen, setSection } = useSessionPanelLayout(seed);
  useEffect(() => report(layout));
  return (
    <div>
      <button type="button" onClick={() => setOpen(!layout.open)}>
        toggle open
      </button>
      <SessionPanel sessionKey="s1" layout={layout} setSection={setSection} openTime={() => {}} />
    </div>
  );
}

const stored = () =>
  JSON.parse(
    localStorage.getItem(SESSION_PANEL_KEY) ?? "null",
  ) as SessionPanelLayout | null;
const section = (id: "recordings" | "chat") =>
  document.getElementById(`session-${id}`)!;
const switchTo = (name: "Recordings" | "Chat") =>
  fireEvent.click(screen.getByRole("radio", { name }));

beforeEach(() => {
  localStorage.clear();
  latest = null;
});
afterEach(() => vi.unstubAllGlobals());

describe("SessionPanel (014 US2)", () => {
  it("shows one section at a time, picked from the header switch", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole("radio", { name: "Recordings" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(section("recordings").className).not.toContain("hidden");
    expect(section("chat").className).toContain("hidden");

    switchTo("Chat");
    expect(screen.getByRole("radio", { name: "Chat" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(section("chat").className).not.toContain("hidden");
    // the other section stays mounted (a recording or a draft survives), only hidden
    expect(section("recordings").className).toContain("hidden");
    expect(latest?.section).toBe("chat");
  });

  it("round-trips the layout through localStorage uh.sessionPanel", () => {
    const first = renderWithProviders(<Harness seed={false} />);
    switchTo("Chat");
    fireEvent.click(screen.getByRole("button", { name: "toggle open" }));
    expect(stored()).toEqual({ open: false, width: 360, section: "chat" });
    first.unmount();

    localStorage.setItem(
      SESSION_PANEL_KEY,
      JSON.stringify({ open: true, width: 420, section: "chat" }),
    );
    renderWithProviders(<Harness seed={true} />);
    // a stored layout wins over the old preference
    expect(latest).toEqual({ open: true, width: 420, section: "chat" });
    expect(screen.getByRole("radio", { name: "Chat" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("is seeded once from the workspaceRightCollapsed preference when nothing is stored", () => {
    const first = renderWithProviders(<Harness seed={true} />);
    expect(latest?.open).toBe(false);
    expect(stored()).toMatchObject({ open: false, width: 360 });
    first.unmount();

    localStorage.clear();
    renderWithProviders(<Harness seed={false} />);
    expect(latest?.open).toBe(true);
    expect(stored()).toMatchObject({ open: true });
  });

  it("writes nothing until the preference has loaded or the student changes the layout", () => {
    function Loading() {
      const [seed, setSeed] = useState<boolean | undefined>(undefined);
      return (
        <>
          <button type="button" onClick={() => setSeed(true)}>
            preferences loaded
          </button>
          <Harness seed={seed} />
        </>
      );
    }
    renderWithProviders(<Loading />);
    expect(latest?.open).toBe(true);
    expect(stored()).toBeNull();
    // the preference arrives: the panel follows it and remembers it
    fireEvent.click(screen.getByRole("button", { name: "preferences loaded" }));
    expect(latest?.open).toBe(false);
    expect(stored()).toMatchObject({ open: false });
  });

  it("puts the close button in the header bar, beside the switch", () => {
    renderWithProviders(<Harness />);
    const close = screen.getByRole("button", { name: "Close session panel" });
    expect(close).toHaveAttribute("aria-keyshortcuts", "Alt+BracketRight");
    expect(close.closest("[data-panel-header]")).toContainElement(
      screen.getByRole("radio", { name: "Chat" }),
    );
  });

  it("shows the registered chat section in the Chat slot", () => {
    const unregister = registerChatSection({
      component: ({ sessionKey }) => <p>chat for {sessionKey}</p>,
      headerActions: () => <button type="button">New chat</button>,
    });
    try {
      renderWithProviders(<Harness />);
      switchTo("Chat");
      expect(
        within(section("chat")).getByText("chat for s1"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New chat" })).toBeVisible();
    } finally {
      act(() => void unregister());
    }
  });
});
