import { ChatCircleText, SidebarSimple, Waveform } from "@phosphor-icons/react";
import { act, fireEvent, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { registerActivitySignal, type ActivitySignal } from "@/app/shell/registry";
import { SideRail, type RailIndicator } from "@/app/shell/SideRail";
import { useSessionRail } from "@/features/sessions/SessionPanel";
import { renderWithProviders } from "./test-utils";

function rail(onActivate = vi.fn(), indicators: { recordings?: RailIndicator; chat?: RailIndicator } = {}, status: { recordings?: string; chat?: string } = {}) {
  return (
    <SideRail
      side="right"
      label="Session panel rail"
      reopen={{ id: "show-session-panel", label: "Show session panel", shortcut: "Alt+BracketRight", shortcutHint: "Alt+]", icon: SidebarSimple, onActivate: () => onActivate("reopen") }}
      items={[
        { id: "recordings", icon: Waveform, name: "Recordings", indicator: indicators.recordings, status: status.recordings, onActivate: () => onActivate("recordings") },
        { id: "chat", icon: ChatCircleText, name: "Chat", indicator: indicators.chat, status: status.chat, onActivate: () => onActivate("chat") },
      ]}
    />
  );
}

/** A test-controlled activity (stands in for the recorder, the transcription job or the chat). */
function fakeSignal(id: string, kind: ActivitySignal["kind"], description: string, teacher?: boolean) {
  let on = false;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };
  const get = () => on;
  const unregister = registerActivitySignal({ id, kind, description, teacher, useActive: () => useSyncExternalStore(subscribe, get, get) });
  return {
    set(v: boolean) {
      on = v;
      listeners.forEach((l) => l());
    },
    unregister,
  };
}

function SessionRail({ expand }: { expand: (s: "recordings" | "chat" | "teacher") => void }) {
  const { rail: spec, watchers } = useSessionRail(expand, () => {});
  return (
    <>
      {watchers}
      <SideRail side="right" label={spec.label} reopen={{ label: spec.reopenLabel, icon: SidebarSimple, onActivate: () => {} }} items={spec.items} />
    </>
  );
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe("SideRail (014 FR-005, FR-006)", () => {
  it("is a navigation landmark with the reopen button and one button per item", async () => {
    const { container } = renderWithProviders(rail());
    const nav = screen.getByRole("navigation", { name: "Session panel rail" });
    const names = [...nav.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Show session panel", "Recordings", "Chat"]);
    expect(screen.getByRole("button", { name: "Show session panel" })).toHaveAttribute("aria-keyshortcuts", "Alt+BracketRight");
    expect(nav.querySelector("[data-indicator]")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("names and shapes each indicator, never by colour alone", () => {
    renderWithProviders(
      rail(vi.fn(), { recordings: "recording", chat: "running" }, { recordings: "recording in progress", chat: "answer being generated" }),
    );
    const rec = screen.getByRole("button", { name: "Recordings, recording in progress" });
    const chat = screen.getByRole("button", { name: "Chat, answer being generated" });
    const dot = rec.querySelector("[data-indicator=recording]")!;
    expect(dot).toHaveAttribute("aria-hidden");
    expect(dot.getAttribute("class")).toMatch(/rounded-full/);
    expect(dot.getAttribute("class")).toMatch(/animate-pulse/);
    const spinner = chat.querySelector("[data-indicator=running]")!;
    // a ring with a gap: a spinner shape
    expect(spinner.getAttribute("class")).toMatch(/border-2/);
    expect(spinner.getAttribute("class")).toMatch(/border-t-transparent/);
    expect(spinner.getAttribute("class")).toMatch(/animate-spin/);
  });

  it("shows a transcription as a spinner and a new answer as a filled dot", () => {
    renderWithProviders(rail(vi.fn(), { recordings: "running", chat: "unseen" }, { recordings: "transcription running", chat: "new answer" }));
    expect(screen.getByRole("button", { name: "Recordings, transcription running" }).querySelector("[data-indicator=running]")).not.toBeNull();
    const filled = screen.getByRole("button", { name: "Chat, new answer" }).querySelector("[data-indicator=unseen]")!;
    expect(filled.getAttribute("class")).toMatch(/rounded-full/);
    expect(filled.getAttribute("class")).toMatch(/bg-primary/);
    expect(filled.getAttribute("class")).not.toMatch(/animate-/);
  });

  it("stops the animation under reduced motion but keeps the indicator", () => {
    renderWithProviders(rail(vi.fn(), { recordings: "recording", chat: "running" }, { recordings: "recording in progress", chat: "answer being generated" }));
    for (const el of document.querySelectorAll("[data-indicator=recording], [data-indicator=running]")) {
      expect(el.getAttribute("class")).toContain("motion-reduce:animate-none");
      // never hidden under reduced motion
      expect(el.getAttribute("class")).not.toMatch(/motion-reduce:(hidden|invisible|opacity-0)/);
    }
  });

  it("calls the item's onActivate (Chat → onActivate('chat'))", () => {
    const onActivate = vi.fn();
    renderWithProviders(rail(onActivate));
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(onActivate).toHaveBeenCalledWith("chat");
    fireEvent.click(screen.getByRole("button", { name: "Show session panel" }));
    expect(onActivate).toHaveBeenLastCalledWith("reopen");
  });
});

describe("useSessionRail (014 FR-006)", () => {
  it("marks Recordings from the recording and transcription signals and Chat from the chat signal", () => {
    const rec = fakeSignal("rec", "recording", "recording in progress");
    const tr = fakeSignal("tr", "transcription", "transcription running");
    cleanups.push(() => void rec.unregister(), () => void tr.unregister());
    const expand = vi.fn();
    renderWithProviders(<SessionRail expand={expand} />);
    expect(screen.getByRole("button", { name: "Recordings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();

    act(() => rec.set(true));
    expect(screen.getByRole("button", { name: "Recordings, recording in progress" }).querySelector("[data-indicator=recording]")).not.toBeNull();
    act(() => {
      rec.set(false);
      tr.set(true);
    });
    expect(screen.getByRole("button", { name: "Recordings, transcription running" }).querySelector("[data-indicator=running]")).not.toBeNull();

    // the chat signal (registered by the chat feature) appears once it exists
    let answer!: ReturnType<typeof fakeSignal>;
    act(() => void (answer = fakeSignal("chat", "answer", "answer being generated")));
    cleanups.push(() => void answer.unregister());
    act(() => answer.set(true));
    expect(screen.getByRole("button", { name: "Chat, answer being generated" }).querySelector("[data-indicator=running]")).not.toBeNull();
    act(() => answer.set(false));
    let unseen!: ReturnType<typeof fakeSignal>;
    act(() => void (unseen = fakeSignal("chat-unseen", "unseen", "new answer")));
    cleanups.push(() => void unseen.unregister());
    act(() => unseen.set(true));
    expect(screen.getByRole("button", { name: "Chat, new answer" }).querySelector("[data-indicator=unseen]")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Chat, new answer" }));
    expect(expand).toHaveBeenCalledWith("chat");
  });

  it("marks AI Teacher, not Chat, while a teacher reply generates (022)", () => {
    const reply = fakeSignal("teacher", "answer", "teacher reply being generated", true);
    cleanups.push(() => void reply.unregister());
    renderWithProviders(<SessionRail expand={vi.fn()} />);
    act(() => reply.set(true));
    const teacher = screen.getByRole("button", { name: "AI Teacher, teacher reply being generated" });
    expect(teacher.querySelector("[data-indicator=running]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Chat" }).querySelector("[data-indicator]")).toBeNull();
  });
});
