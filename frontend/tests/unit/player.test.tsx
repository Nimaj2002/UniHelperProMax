import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { Recording } from "@/features/recordings/api";
import { Player } from "@/features/recordings/Player";
import { json, mockFetch, on, renderWithProviders } from "./test-utils";

const recording = {
  id: "r1", sessionKey: "L:2026-10-05", name: "Recording 10:02", fileName: "Recording 10-02.webm",
  mimeType: "audio/webm", status: "complete", startedAt: "2026-10-05T07:02:00Z", durationMs: 60_000,
  size: 1000, nextSeq: 12, active: false, missing: false, version: 1,
} as Recording;

// jsdom has no media playback: give HTMLMediaElement a minimal working model
let playing: HTMLMediaElement[] = [];
beforeEach(() => {
  playing = [];
  const times = new WeakMap<HTMLMediaElement, number>();
  const paused = new WeakMap<HTMLMediaElement, boolean>();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, false);
    playing.push(this);
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    if (paused.get(this) === false) {
      paused.set(this, true);
      this.dispatchEvent(new Event("pause"));
    }
  });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get() { return paused.get(this) ?? true; } });
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get() { return times.get(this) ?? 0; },
    set(v: number) { times.set(this, v); },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 60 });
});
afterEach(() => vi.restoreAllMocks());

function setup(prefs = { playerVolume: 0.8, playerMuted: false }) {
  let stored: Record<string, unknown> = { ...prefs };
  const api = mockFetch(
    on("GET", "/api/v1/preferences", () => json(stored)),
    on("PATCH", "/api/v1/preferences", (_u, init) => {
      stored = { ...stored, ...JSON.parse(String(init.body)) };
      return json(stored);
    }),
  );
  const view = renderWithProviders(<Player recording={recording} />);
  const audio = view.container.querySelector("audio")!;
  return { ...view, api, audio, patches: () => api.calls.filter((c) => c.init.method === "PATCH").map((c) => JSON.parse(String(c.init.body))) };
}

describe("Player", () => {
  it("has named controls and no axe violations", async () => {
    const { container } = setup();
    const group = screen.getByRole("group", { name: "Player: Recording 10:02" });
    for (const name of ["Play", "Stop", "Back 5 seconds", "Forward 5 seconds", "Mute"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("slider", { name: "Seek" })).toHaveAttribute("aria-valuetext", "0:00 of 1:00");
    expect(screen.getByRole("slider", { name: "Volume" })).toBeInTheDocument();
    expect(group).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("plays and pauses; stop returns to the start", async () => {
    const user = userEvent.setup();
    const { audio } = setup();
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    audio.currentTime = 20;
    fireEvent.timeUpdate(audio);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(0);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("±5 s skips clamp at both ends and update the seek value text", async () => {
    const user = userEvent.setup();
    const { audio } = setup();
    await user.click(screen.getByRole("button", { name: "Back 5 seconds" }));
    expect(audio.currentTime).toBe(0);
    await user.click(screen.getByRole("button", { name: "Forward 5 seconds" }));
    expect(audio.currentTime).toBe(5);
    expect(screen.getByRole("slider", { name: "Seek" })).toHaveAttribute("aria-valuetext", "0:05 of 1:00");
    audio.currentTime = 58;
    fireEvent.timeUpdate(audio);
    await user.click(screen.getByRole("button", { name: "Forward 5 seconds" }));
    expect(audio.currentTime).toBe(60);
  });

  it("keyboard: K toggles, J/L skip, arrows on the seek slider skip 5 s, PageUp 60 s", async () => {
    const user = userEvent.setup();
    const { audio } = setup();
    screen.getByRole("button", { name: "Stop" }).focus();
    await user.keyboard("k");
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    await user.keyboard("l");
    expect(audio.currentTime).toBe(5);
    await user.keyboard("j");
    expect(audio.currentTime).toBe(0);
    screen.getByRole("slider", { name: "Seek" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(audio.currentTime).toBe(5);
    await user.keyboard("{PageUp}");
    expect(audio.currentTime).toBe(60);
  });

  it("only one recording plays at a time", async () => {
    const user = userEvent.setup();
    mockFetch(on("GET", "/api/v1/preferences", () => json({})));
    const view = renderWithProviders(
      <>
        <Player recording={recording} />
        <Player recording={{ ...recording, id: "r2", name: "Recording 11:00" }} />
      </>,
    );
    const [a, b] = Array.from(view.container.querySelectorAll("audio"));
    await user.click(screen.getAllByRole("button", { name: "Play" })[0]);
    expect(a.paused).toBe(false);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(b.paused).toBe(false);
    expect(a.paused).toBe(true);
  });

  it("volume and mute come from and are saved to /preferences", async () => {
    const user = userEvent.setup();
    const { audio, patches } = setup({ playerVolume: 0.5, playerMuted: false });
    await waitFor(() => expect(audio.volume).toBe(0.5));
    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(await screen.findByRole("button", { name: "Unmute" })).toBeInTheDocument();
    await waitFor(() => expect(audio.muted).toBe(true));
    expect(patches()).toContainEqual({ playerMuted: true });
    screen.getByRole("button", { name: "Unmute" }).focus();
    await user.keyboard("m");
    await waitFor(() => expect(patches()).toContainEqual({ playerMuted: false }));
    screen.getByRole("slider", { name: "Volume" }).focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(patches()).toContainEqual({ playerVolume: 0.55, playerMuted: false }));
  });
});
