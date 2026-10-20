/** 014 T066: the chat run store over a fake EventSource (research R13, contracts/chat-stream.md). */
import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStore, useChatGenerating, useGenerating, useRun, useUnseenHere } from "@/features/chat/runStore";
import { json, mockFetch, on } from "./test-utils";

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;
  onerror: (() => void) | null = null;
  private handlers = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, id: number, data: unknown) {
    const e = new MessageEvent(type, { data: JSON.stringify(data), lastEventId: String(id) });
    this.handlers.get(type)?.forEach((h) => h(e));
  }
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

const RUN = { runId: "r1", chatId: "c1", sessionKey: "s1", answerId: "a1" };
const START = { runId: "r1", chatId: "c1", turnId: "t1", answerId: "a1", endpointLabel: "Local", modelLabel: "echo", locality: "local" };
const lastSource = () => FakeEventSource.all.at(-1)!;
/** Let the coalesced text notification (one per animation frame) run. */
const frame = () => act(() => vi.advanceTimersByTime(20));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  runStore().reset();
  runStore().configure(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("run store", () => {
  it("accumulates text and follows start → done; invalidates the chat at the end", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    runStore().configure(qc);
    const { result } = renderHook(() => useRun("r1"));
    act(() => runStore().track(RUN));
    expect(result.current?.status).toBe("queued");
    const es = lastSource();
    expect(es.url).toBe("/api/v1/chat-runs/r1/events");
    act(() => es.emit("start", 1, START));
    expect(result.current).toMatchObject({ status: "streaming", started: true, modelLabel: "echo" });
    act(() => {
      es.emit("delta", 2, { text: "Hel" });
      es.emit("delta", 3, { text: "lo" });
    });
    frame();
    expect(result.current?.text).toBe("Hello");
    act(() => es.emit("usage", 4, { input: 3, output: 2 }));
    act(() => es.emit("done", 5, { status: "completed", usage: { input: 3, output: 2, total: 5 } }));
    expect(result.current).toMatchObject({ status: "completed", text: "Hello", usage: { total: 5 } });
    expect(es.readyState).toBe(FakeEventSource.CLOSED);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "c1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chats", "s1"] });
  });

  it("stopped and failed end the run with their state", () => {
    act(() => runStore().track(RUN));
    act(() => runStore().track({ ...RUN, runId: "r2", chatId: "c2", answerId: "a2" }));
    const [one, two] = FakeEventSource.all;
    act(() => {
      one.emit("start", 1, START);
      one.emit("delta", 2, { text: "part" });
      one.emit("stopped", 3, { status: "stopped" });
    });
    expect(runStore().get("r1")).toMatchObject({ status: "stopped", text: "part" });
    act(() => two.emit("failed", 1, { status: "failed", error: { category: "key_rejected", message: "401" } }));
    expect(runStore().get("r2")).toMatchObject({ status: "failed", error: { category: "key_rejected" } });
  });

  it("a snapshot replaces the text", () => {
    act(() => runStore().track(RUN));
    act(() => {
      lastSource().emit("delta", 1, { text: "old" });
      lastSource().emit("snapshot", 1, { text: "The whole saved answer", status: "completed" });
    });
    expect(runStore().get("r1")).toMatchObject({ text: "The whole saved answer", status: "completed" });
  });

  it("reconnects with Last-Event-ID and never repeats an event", () => {
    act(() => runStore().track(RUN));
    const first = lastSource();
    act(() => {
      first.emit("start", 1, START);
      first.emit("delta", 2, { text: "ab" });
    });
    act(() => first.fail());
    act(() => vi.advanceTimersByTime(600));
    const second = lastSource();
    expect(second).not.toBe(first);
    expect(second.url).toBe("/api/v1/chat-runs/r1/events?lastEventId=2");
    act(() => {
      second.emit("delta", 2, { text: "ab" }); // a replay of an event already handled
      second.emit("delta", 3, { text: "c" });
    });
    frame();
    expect(runStore().get("r1")?.text).toBe("abc");
  });

  it("views share one EventSource, and leaving every view doesn't stop the run", () => {
    const a = renderHook(() => useRun("r1"));
    const b = renderHook(() => useRun("r1"));
    act(() => {
      runStore().track(RUN);
      runStore().track(RUN);
    });
    expect(FakeEventSource.all).toHaveLength(1);
    a.unmount();
    b.unmount();
    expect(lastSource().readyState).toBe(FakeEventSource.OPEN);
    act(() => lastSource().emit("delta", 1, { text: "still going" }));
    frame();
    expect(runStore().get("r1")?.text).toBe("still going");
  });

  it("reports generating and unseen per session for the rail", () => {
    const generating = renderHook(() => useGenerating("s1"));
    const elsewhere = renderHook(() => useGenerating("s2"));
    const chat = renderHook(() => useChatGenerating("c1"));
    const unseen = renderHook(() => useUnseenHere("s1"));
    act(() => runStore().track(RUN));
    expect(generating.result.current).toBe(true);
    expect(chat.result.current).toBe(true);
    expect(elsewhere.result.current).toBe(false);
    act(() => lastSource().emit("done", 1, { status: "completed" }));
    expect(generating.result.current).toBe(false);
    // nobody had the chat on screen: a new answer
    expect(unseen.result.current).toBe(true);
    act(() => runStore().setVisible("c1", true));
    expect(unseen.result.current).toBe(false);
  });

  it("an answer that ends on screen is not unseen", () => {
    const unseen = renderHook(() => useUnseenHere("s1"));
    act(() => {
      runStore().setVisible("c1", true);
      runStore().track(RUN);
    });
    act(() => lastSource().emit("done", 1, { status: "completed" }));
    expect(unseen.result.current).toBe(false);
  });

  it("reattaches to the runs still generating on load", async () => {
    vi.useRealTimers();
    mockFetch(on("GET", "/api/v1/chat-runs/active", () => json([{ id: "r9", chatId: "c9", sessionKey: "s9", answerId: "a9", status: "streaming" }])));
    await act(() => runStore().attachActive());
    expect(runStore().get("r9")).toMatchObject({ chatId: "c9", status: "streaming" });
    expect(lastSource().url).toBe("/api/v1/chat-runs/r9/events");
  });
});
