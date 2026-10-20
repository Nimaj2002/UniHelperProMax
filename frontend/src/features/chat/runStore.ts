/**
 * 014 US3 (research R13): the chat runs of this browser, one module singleton read with
 * `useSyncExternalStore` (the `recorder()` pattern). It holds one `EventSource` per run and the
 * text received so far; the panel and the chat tab are only views on it, so moving a chat or
 * closing a view never touches a run (FR-045). Text updates are coalesced to one notification per
 * animation frame.
 */
import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { subscribeRun, TERMINAL_EVENTS, type RunEvent, type RunStatus } from "@/lib/api/stream";
import { fetchActiveRuns, invalidateChat, stopRun, type AnswerError, type ChatUsage } from "./api";

export interface RunView {
  runId: string;
  chatId: string;
  sessionKey: string;
  answerId: string;
  text: string;
  status: RunStatus;
  /** The `start` event arrived (the progress indicator shows until the first text). */
  started: boolean;
  usage: ChatUsage | null;
  error: AnswerError | null;
  endpointLabel?: string;
  modelLabel?: string;
  locality?: "local" | "remote" | null;
}

export interface TrackRun {
  runId: string;
  chatId: string;
  sessionKey: string;
  answerId: string;
  status?: RunStatus;
}

export const isActiveStatus = (s: RunStatus | undefined) => s === "queued" || s === "streaming";

const raf: (cb: () => void) => unknown =
  typeof requestAnimationFrame === "function" ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 16);

class RunStore {
  private runs = new Map<string, RunView>();
  private closers = new Map<string, () => void>();
  private pending = new Map<string, string>();
  private frame = false;
  private listeners = new Set<() => void>();
  private visible = new Map<string, number>();
  private unseen = new Set<string>();
  private qc: QueryClient | null = null;
  private attached: Promise<void> | null = null;
  private version = 0;

  /** The query client whose chat queries are refreshed when a run ends. */
  configure(qc: QueryClient | null) {
    this.qc = qc;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getVersion = () => this.version;

  private notify() {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }

  get(runId: string | null | undefined): RunView | undefined {
    return runId ? this.runs.get(runId) : undefined;
  }

  /** The chat's newest run this browser knows (an active one first). */
  ofChat(chatId: string | null | undefined): RunView | undefined {
    if (!chatId) return undefined;
    let found: RunView | undefined;
    for (const r of this.runs.values()) if (r.chatId === chatId && (!found || isActiveStatus(r.status) || !isActiveStatus(found.status))) found = r;
    return found;
  }

  generatingChats(): string[] {
    return [...this.runs.values()].filter((r) => isActiveStatus(r.status)).map((r) => r.chatId);
  }

  isGenerating(sessionKey?: string): boolean {
    for (const r of this.runs.values()) if (isActiveStatus(r.status) && (!sessionKey || r.sessionKey === sessionKey)) return true;
    return false;
  }

  /** A run ended here while no view showed its chat (cleared when a view shows it). */
  hasUnseen(sessionKey?: string): boolean {
    for (const chatId of this.unseen) {
      const r = this.ofChat(chatId);
      if (!sessionKey || r?.sessionKey === sessionKey) return true;
    }
    return false;
  }

  isUnseen(chatId: string) {
    return this.unseen.has(chatId);
  }

  /** A conversation view shows (or stops showing) this chat. */
  setVisible(chatId: string, on: boolean) {
    const n = (this.visible.get(chatId) ?? 0) + (on ? 1 : -1);
    if (n > 0) this.visible.set(chatId, n);
    else this.visible.delete(chatId);
    if (on && this.unseen.delete(chatId)) this.notify();
  }

  isVisible(chatId: string) {
    return (this.visible.get(chatId) ?? 0) > 0;
  }

  /** Follow a run (no-op when it is already followed): one EventSource however many views. */
  track(run: TrackRun) {
    const known = this.runs.get(run.runId);
    if (known && (this.closers.has(run.runId) || !isActiveStatus(known.status))) return;
    this.runs.set(run.runId, {
      runId: run.runId,
      chatId: run.chatId,
      sessionKey: run.sessionKey || known?.sessionKey || "",
      answerId: run.answerId,
      text: known?.text ?? "",
      status: run.status ?? "queued",
      started: false,
      usage: null,
      error: null,
    });
    this.notify();
    const close = subscribeRun(run.runId, {
      onEvent: (e) => this.onEvent(run.runId, e),
      onGiveUp: () => this.drop(run.runId),
    });
    this.closers.set(run.runId, close);
  }

  /** Reattach to the runs still generating (once per page load). */
  attachActive(): Promise<void> {
    this.attached ??= fetchActiveRuns().then(
      (runs) => {
        for (const r of runs) if (isActiveStatus(r.status)) this.track({ runId: r.id, chatId: r.chatId, sessionKey: r.sessionKey, answerId: r.answerId, status: r.status });
      },
      () => {
        this.attached = null;
      },
    );
    return this.attached;
  }

  async stop(runId: string) {
    const out = await stopRun(runId);
    // the `stopped` event normally follows; make sure the view settles even without it
    const r = this.runs.get(runId);
    if (r && isActiveStatus(r.status) && !isActiveStatus(out.status)) this.finish(runId, { ...r, status: out.status });
    return out;
  }

  private update(runId: string, patch: Partial<RunView>) {
    const r = this.runs.get(runId);
    if (!r) return;
    this.runs.set(runId, { ...r, ...patch });
    this.notify();
  }

  private flushText = () => {
    this.frame = false;
    if (!this.pending.size) return;
    for (const [runId, add] of this.pending) {
      const r = this.runs.get(runId);
      if (r) this.runs.set(runId, { ...r, text: r.text + add, status: r.status === "queued" ? "streaming" : r.status });
    }
    this.pending.clear();
    this.notify();
  };

  private flushNow(runId: string) {
    const add = this.pending.get(runId);
    if (add === undefined) return;
    this.pending.delete(runId);
    const r = this.runs.get(runId);
    if (r) this.runs.set(runId, { ...r, text: r.text + add });
  }

  private onEvent(runId: string, e: RunEvent) {
    switch (e.type) {
      case "start":
        this.update(runId, {
          started: true,
          status: "streaming",
          endpointLabel: e.data.endpointLabel,
          modelLabel: e.data.modelLabel,
          locality: e.data.locality,
        });
        return;
      case "delta":
        this.pending.set(runId, (this.pending.get(runId) ?? "") + e.data.text);
        if (!this.frame) {
          this.frame = true;
          raf(this.flushText);
        }
        return;
      case "usage":
        this.update(runId, { usage: e.data });
        return;
      case "snapshot": {
        this.pending.delete(runId);
        const r = this.runs.get(runId);
        if (!r) return;
        // the server no longer buffers this run: its saved answer is the truth
        if (isActiveStatus(e.data.status)) return this.drop(runId);
        this.finish(runId, { ...r, text: e.data.text, status: e.data.status });
        return;
      }
      default: {
        if (!TERMINAL_EVENTS.has(e.type)) return;
        this.flushNow(runId);
        const r = this.runs.get(runId);
        if (!r) return;
        const data = e.data as { status: RunStatus; usage?: ChatUsage | null; error?: AnswerError };
        this.finish(runId, { ...r, status: data.status, usage: data.usage ?? r.usage, error: data.error ?? null });
      }
    }
  }

  private finish(runId: string, next: RunView) {
    this.closers.get(runId)?.();
    this.closers.delete(runId);
    this.runs.set(runId, next);
    if (!this.isVisible(next.chatId)) this.unseen.add(next.chatId);
    if (this.qc) invalidateChat(this.qc, next.chatId, next.sessionKey || undefined);
    this.notify();
  }

  private drop(runId: string) {
    const r = this.runs.get(runId);
    this.closers.get(runId)?.();
    this.closers.delete(runId);
    this.pending.delete(runId);
    this.runs.delete(runId);
    if (r && this.qc) invalidateChat(this.qc, r.chatId, r.sessionKey || undefined);
    this.notify();
  }

  /** Tests: forget everything. */
  reset() {
    for (const c of this.closers.values()) c();
    this.closers.clear();
    this.runs.clear();
    this.pending.clear();
    this.frame = false;
    this.visible.clear();
    this.unseen.clear();
    this.attached = null;
    this.notify();
  }
}

let store: RunStore | null = null;
export function runStore(): RunStore {
  store ??= new RunStore();
  return store;
}

function useStore<T>(read: (s: RunStore) => T): T {
  const s = runStore();
  return useSyncExternalStore(s.subscribe, () => read(s), () => read(s));
}

export const useRun = (runId: string | null | undefined) => useStore((s) => s.get(runId));
export const useChatRun = (chatId: string | null | undefined) => useStore((s) => s.ofChat(chatId));
/** True while an answer is generated in this session (or anywhere, without a key). */
export const useGenerating = (sessionKey?: string) => useStore((s) => s.isGenerating(sessionKey));
/** True while an answer generates in this chat (re-renders only when that changes). */
export const useChatGenerating = (chatId: string | null | undefined) => useStore((s) => isActiveStatus(s.ofChat(chatId)?.status));
export const useUnseenHere = (sessionKey?: string) => useStore((s) => s.hasUnseen(sessionKey));
/** The ids of the chats generating now, joined (a stable primitive snapshot). */
export function useGeneratingChats(): Set<string> {
  const joined = useStore((s) => s.generatingChats().sort().join("\n"));
  return new Set(joined ? joined.split("\n") : []);
}
