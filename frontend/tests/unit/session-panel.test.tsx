import { act, fireEvent, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_PANEL_KEY, SessionPanel, useSessionPanelLayout, type SessionPanelLayout } from "@/features/sessions/SessionPanel";
import { registerChatSection } from "@/features/sessions/workspace-panels";
import { renderWithProviders } from "./test-utils";

let latest: SessionPanelLayout | null = null;
const report = (l: SessionPanelLayout) => void (latest = l);

/** The workspace's use of the panel: its layout hook (seeded by the preference) and its body. */
function Harness({ seed }: { seed?: boolean }) {
  const { layout, setOpen, setShare, setCollapsed } = useSessionPanelLayout(seed);
  useEffect(() => report(layout));
  return (
    <div>
      <button type="button" onClick={() => setOpen(!layout.open)}>
        toggle open
      </button>
      <SessionPanel sessionKey="s1" layout={layout} setShare={setShare} setCollapsed={setCollapsed} />
    </div>
  );
}

const stored = () => JSON.parse(localStorage.getItem(SESSION_PANEL_KEY) ?? "null") as SessionPanelLayout | null;
const section = (name: "Recordings" | "Chat") => screen.getByRole("button", { name: new RegExp(`^(Collapse|Expand) ${name}$`) }).closest("section")!;
const flexGrow = (el: HTMLElement) => el.style.flex.split(" ")[0];

beforeEach(() => {
  localStorage.clear();
  latest = null;
});
afterEach(() => vi.unstubAllGlobals());

describe("SessionPanel (014 US2)", () => {
  it("shows Recordings above Chat, each collapsing to its header while the other fills the panel", () => {
    renderWithProviders(<Harness />);
    const collapseRec = screen.getByRole("button", { name: "Collapse Recordings" });
    const collapseChat = screen.getByRole("button", { name: "Collapse Chat" });
    expect(collapseRec).toHaveAttribute("aria-expanded", "true");
    expect(collapseRec.compareDocumentPosition(collapseChat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize Recordings and Chat" })).toHaveAttribute("aria-orientation", "horizontal");

    fireEvent.click(collapseRec);
    const expandRec = screen.getByRole("button", { name: "Expand Recordings" });
    expect(expandRec).toHaveAttribute("aria-expanded", "false");
    expect(section("Recordings").querySelector("[id$=-body]")).toHaveAttribute("hidden");
    expect(section("Recordings").className).toContain("shrink-0");
    expect(flexGrow(section("Chat"))).toBe("1");
    // no boundary while only one section is open
    expect(screen.queryByRole("separator", { name: "Resize Recordings and Chat" })).toBeNull();

    fireEvent.click(expandRec);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Chat" }));
    expect(screen.getByRole("button", { name: "Expand Chat" })).toHaveAttribute("aria-expanded", "false");
    expect(section("Chat").className).toContain("shrink-0");
    expect(flexGrow(section("Recordings"))).toBe("1");
    expect(latest?.collapsed).toEqual({ recordings: false, chat: true });
  });

  it("moves the boundary by 5 % with ↑/↓, to the ends with Home/End and back to 50/50 with Enter", () => {
    renderWithProviders(<Harness />);
    const boundary = screen.getByRole("separator", { name: "Resize Recordings and Chat" });
    expect(boundary).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(boundary, { key: "ArrowDown" });
    expect(boundary).toHaveAttribute("aria-valuenow", "55");
    fireEvent.keyDown(boundary, { key: "ArrowUp" });
    fireEvent.keyDown(boundary, { key: "ArrowUp" });
    expect(boundary).toHaveAttribute("aria-valuenow", "45");
    expect(flexGrow(section("Recordings"))).toBe("45");
    expect(flexGrow(section("Chat"))).toBe("55");
    fireEvent.keyDown(boundary, { key: "Home" });
    const min = Number(boundary.getAttribute("aria-valuemin"));
    expect(boundary).toHaveAttribute("aria-valuenow", String(min));
    fireEvent.keyDown(boundary, { key: "End" });
    expect(boundary).toHaveAttribute("aria-valuenow", String(100 - min));
    fireEvent.keyDown(boundary, { key: "Enter" });
    expect(boundary).toHaveAttribute("aria-valuenow", "50");
  });

  it("keeps each section at least its header plus 120 px", () => {
    renderWithProviders(<Harness />);
    for (const name of ["Recordings", "Chat"] as const) expect(section(name).className).toContain("min-h-[160px]");
  });

  it("round-trips the layout through localStorage uh.sessionPanel", () => {
    const first = renderWithProviders(<Harness seed={false} />);
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Recordings and Chat" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: "toggle open" }));
    expect(stored()).toEqual({ open: false, width: 360, weights: { recordings: 55, chat: 45 }, collapsed: { recordings: false, chat: false } });
    first.unmount();

    localStorage.setItem(SESSION_PANEL_KEY, JSON.stringify({ open: true, width: 420, weights: { recordings: 30, chat: 70 }, collapsed: { recordings: false, chat: true } }));
    renderWithProviders(<Harness seed={true} />);
    // a stored layout wins over the old preference
    expect(latest).toEqual({ open: true, width: 420, weights: { recordings: 30, chat: 70 }, collapsed: { recordings: false, chat: true } });
    expect(screen.getByRole("button", { name: "Expand Chat" })).toBeInTheDocument();
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

  it("puts the close button in the Recordings header", () => {
    renderWithProviders(<Harness />);
    const close = screen.getByRole("button", { name: "Close session panel" });
    expect(close).toHaveAttribute("aria-keyshortcuts", "Alt+BracketRight");
    expect(section("Recordings")).toContainElement(close);
    expect(section("Chat")).not.toContainElement(close);
    // in the header row, not in the section's body
    expect(within(section("Recordings")).getByRole("button", { name: "Collapse Recordings" }).closest("div")).toContainElement(close);
  });

  it("shows the registered chat section in the Chat slot", () => {
    const unregister = registerChatSection({
      component: ({ sessionKey }) => <p>chat for {sessionKey}</p>,
      headerActions: () => <button type="button">New chat</button>,
    });
    try {
      renderWithProviders(<Harness />);
      expect(within(section("Chat")).getByText("chat for s1")).toBeInTheDocument();
      expect(within(section("Chat")).getByRole("button", { name: "New chat" })).toBeInTheDocument();
    } finally {
      act(() => void unregister());
    }
  });
});
