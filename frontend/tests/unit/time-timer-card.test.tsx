// 020 T024: the timer card starts and stops a Track timer, offers Undo for a replaced or too-short
// run, and keeps an unsent Stop with the moment it was pressed while the server is unreachable.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerCard } from "@/features/time/TimerCard";
import { json, mockFetch, on, renderWithProviders } from "./test-utils";

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const NOW = "2026-11-02T09:00:00.000Z";
const timer = (over: Record<string, unknown> = {}) => ({
  style: "track", state: "running", startedAt: NOW, pausedAt: null, pausedMs: 0, plannedEndAt: null, finishedAt: null,
  description: "Problem set", tagId: null, courseId: null, taskId: null, sessionKey: null, linkTitle: null,
  phase: null, period: null, focusMinutes: null, goal: null, hidePanels: false, reminderAck: 0, version: 1, ...over,
});
const res = (t: unknown, extra: Record<string, unknown> = {}) => json({ timer: t, serverNow: NOW, settled: [], undo: null, saved: null, ...extra });

const common = [
  on("GET", "/api/v1/time/tags", () => json([])),
  on("GET", "/api/v1/preferences", () => json({})),
  on("GET", "/api/v1/auth/me", () => json({ id: "u1", username: "owner", timezone: "UTC" })),
];

beforeEach(() => {
  localStorage.clear();
  toastMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("TimerCard", () => {
  it("starts a Track timer with its description and stops it", async () => {
    let current: unknown = null;
    const start = vi.fn();
    mockFetch(
      ...common,
      on("GET", "/api/v1/time/timer", () => res(current)),
      on("POST", "/api/v1/time/timer/start", (_u, init) => {
        start(JSON.parse(String(init.body)));
        current = timer();
        return res(current);
      }),
      on("POST", "/api/v1/time/timer/stop", () => {
        current = null;
        return res(null, { undo: { previous: timer(), entryId: null } });
      }),
    );
    renderWithProviders(<TimerCard />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Description" }), { target: { value: "Problem set" } });
    fireEvent.click(screen.getByRole("button", { name: /start timer/i }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ style: "track", description: "Problem set" })));
    expect(start.mock.calls[0]![0].at).toBeTruthy(); // the moment the user pressed Start
    const stop = await screen.findByRole("button", { name: /^stop$/i });
    fireEvent.click(stop);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("Not saved: under 5 seconds.", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) })));
  });

  it("keeps a Stop that can't reach the server and says it is retrying", async () => {
    let up = true;
    mockFetch(
      ...common,
      on("GET", "/api/v1/time/timer", () => res(timer())),
      on("POST", "/api/v1/time/timer/stop", () => {
        if (!up) throw new TypeError("offline");
        return res(null, { saved: null });
      }),
    );
    renderWithProviders(<TimerCard />);
    const stop = await screen.findByRole("button", { name: /^stop$/i });
    up = false;
    await act(async () => fireEvent.click(stop));
    expect(await screen.findByText("Not saved yet — retrying.")).toBeInTheDocument();
    const queued = JSON.parse(localStorage.getItem("uh.time.outbox") ?? "[]");
    expect(queued).toEqual([expect.objectContaining({ path: "/stop", version: 1, body: { at: expect.any(String) } })]);
  });
});
