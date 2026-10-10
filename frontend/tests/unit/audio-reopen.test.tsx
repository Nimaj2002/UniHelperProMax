import { act, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerActivitySignal } from "@/app/shell/registry";
import { AudioReopenButton } from "@/features/sessions/AudioReopenButton";
import { renderWithProviders } from "./test-utils";

/** A test-controlled activity (stands in for the recorder / the transcription job). */
function fakeSignal(id: string, kind: "recording" | "transcription", description: string) {
  let on = false;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };
  const get = () => on;
  const unregister = registerActivitySignal({ id, kind, description, useActive: () => useSyncExternalStore(subscribe, get, get) });
  return {
    set(v: boolean) {
      on = v;
      listeners.forEach((l) => l());
    },
    unregister,
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe("AudioReopenButton (008 FR-022)", () => {
  it("names and marks a recording in progress and a running transcription", () => {
    const rec = fakeSignal("rec", "recording", "recording in progress");
    const tr = fakeSignal("tr", "transcription", "transcription running");
    cleanups.push(() => void rec.unregister(), () => void tr.unregister());
    const onOpen = vi.fn();
    renderWithProviders(<AudioReopenButton onOpen={onOpen} />);
    const button = () => screen.getByRole("button", { name: /^Show audio panel/ });

    expect(button()).toHaveAccessibleName("Show audio panel");
    expect(button().querySelector("[data-indicator]")).toBeNull();

    act(() => rec.set(true));
    expect(button()).toHaveAccessibleName("Show audio panel, recording in progress");
    const dot = button().querySelector("[data-indicator=recording]")!;
    expect(dot).toHaveAttribute("aria-hidden");
    expect(dot.getAttribute("class")).toContain("motion-reduce:animate-none");

    act(() => tr.set(true));
    expect(button()).toHaveAccessibleName("Show audio panel, recording in progress, transcription running");
    expect(button().querySelector("[data-indicator=transcription]")).not.toBeNull();

    act(() => rec.set(false));
    expect(button()).toHaveAccessibleName("Show audio panel, transcription running");
    expect(button().querySelector("[data-indicator=recording]")).toBeNull();

    act(() => button().click());
    expect(onOpen).toHaveBeenCalled();
  });
});
