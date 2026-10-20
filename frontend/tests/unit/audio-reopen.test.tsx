import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/app/shell/AppShell";
import { WorkspacePage } from "@/features/sessions/WorkspacePage";
import { json, mockFetch, renderRoutes } from "./test-utils";

const SESSION = {
  key: "s1", kind: "class", lineageId: "l1", seriesId: "r1", seriesVersion: 1, courseId: "c1", courseName: "CS 101", semesterId: "sem1",
  title: null, date: "2026-12-07", start: "10:00", end: "11:30", location: null, color: "teal", links: [], recurrenceSummary: "",
  isException: false, exceptionVersion: null, status: "upcoming", scheduled: true,
};

function render(prefs: Record<string, unknown> = {}) {
  mockFetch((url) => {
    const p = url.pathname.replace(/^\/api\/v1/, "");
    if (p === "/sessions/s1") return json(SESSION);
    if (p === "/preferences") return json(prefs);
    if (p === "/workspace/s1") return json({ tabs: [], active: null, split: null });
    if (p.endsWith("/timeline")) return json({ entries: [] });
    if (p === "/auth/me" || p === "/me") return json({ id: "u1", username: "student", role: "owner", timezone: "UTC" });
    // notes, documents, recordings, courses, …: empty lists
    return json([]);
  });
  return renderRoutes([{ element: <AppShell />, children: [{ path: "courses/:courseId/sessions/:sessionKey", element: <WorkspacePage /> }] }], "/courses/c1/sessions/s1");
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("innerWidth", 1366);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("1100"), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("the session panel's reopen button (014 US2, replaces 008 FR-015's tab-row button)", () => {
  it("is on the rail, not in the tab row", async () => {
    render();
    const close = await screen.findByRole("button", { name: "Close session panel" });
    expect(screen.getByRole("complementary", { name: "Session panel" })).toContainElement(close);
    fireEvent.click(close);
    const show = await screen.findByRole("button", { name: "Show session panel" });
    expect(screen.getByRole("navigation", { name: "Session panel rail" })).toContainElement(show);
    // the tab row keeps its focus mode button but no reopen button
    const main = screen.getByRole("main", { name: "Workspace" });
    expect(main).not.toContainElement(show);
    expect(main).toContainElement(screen.getByRole("button", { name: "Enter focus mode" }));
    expect(main.querySelector("[aria-keyshortcuts='Alt+BracketRight']")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Show audio panel/ })).toBeNull();
  });

  it("starts closed to the rail when the old preference said the audio card was closed", async () => {
    render({ workspaceRightCollapsed: true });
    await screen.findByRole("button", { name: "Show session panel" });
    await act(async () => {});
    expect(screen.queryByRole("complementary", { name: "Session panel" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("uh.sessionPanel")!)).toMatchObject({ open: false });
  });
});
