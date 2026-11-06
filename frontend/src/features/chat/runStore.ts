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
  /** 022: a teacher reply as it streams — prose, question cards and malformed blocks in order. */
  segments: LiveSegment[];
  /** 022: a lesson or practice reply (the rail marks AI Teacher, not Chat). */
  teacher: boolean;
}

export type LiveSegment =
  | { type: "markdown"; text: string }
  | { type: "question"; questionId: string }
  | { type: "malformed"; id: string; reason: string };

/** 022: the text marker a plan block leaves in a teacher reply (as the server's segments do). */
export const PLAN_MARKER = "\n\n*Plan updated.*\n\n";

function appendText(segments: LiveSegment[], text: string): LiveSegment[] {
  const last = segments[segments.length - 1];
  if (last?.type === "markdown") return [...segments.slice(0, -1), { type: "markdown", text: last.text + text }];
  return [...segments, { type: "markdown", text }];
}

export interface TrackRun {
  runId: string;
  chatId: string;
  sessionKey: string;
  answerId: string;
  status?: RunStatus;
  teacher?: boolean;
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

  isGenerating(sessionKey?: string, teacher = false): boolean {
    for (const r of this.runs.values())
      if (isActiveStatus(r.status) && r.teacher === teacher && (!sessionKey || r.sessionKey === sessionKey)) return true;
    return false;
  }

  /** A run ended here while no view showed its chat (cleared when a view shows it). */
  hasUnseen(sessionKey?: string, teacher = false): boolean {
    for (const chatId of this.unseen) {
      const r = this.ofChat(chatId);
      if ((r?.teacher ?? false) === teacher && (!sessionKey || r?.sessionKey === sessionKey)) return true;
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
      segments: known?.segments ?? [],
      teacher: run.teacher ?? known?.teacher ?? false,
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
        for (const r of runs) if (isActiveStatus(r.status)) this.track({ runId: r.id, chatId: r.chatId, sessionKey: r.sessionKey, answerId: r.answerId, status: r.status, teacher: r.teacher });
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
      if (r)
        this.runs.set(runId, {
          ...r,
          text: r.text + add,
          segments: appendText(r.segments, add),
          status: r.status === "queued" ? "streaming" : r.status,
        });
    }
    this.pending.clear();
    this.notify();
  };

  private flushNow(runId: string) {
    const add = this.pending.get(runId);
    if (add === undefined) return;
    this.pending.delete(runId);
    const r = this.runs.get(runId);
    if (r) this.runs.set(runId, { ...r, text: r.text + add, segments: appendText(r.segments, add) });
  }

  /** 022: a teacher block arrived — place it after the text so far, refresh the chat's questions. */
  private onBlock(runId: string, e: RunEvent) {
    this.flushNow(runId);
    const r = this.runs.get(runId);
    if (!r) return;
    let segments = r.segments;
    if (e.type === "question") segments = [...segments, { type: "question", questionId: e.data.id }];
    else if (e.type === "malformed") segments = [...segments, { type: "malformed", id: e.data.id, reason: e.data.reason }];
    else if (e.type === "plan") segments = appendText(segments, PLAN_MARKER);
    this.runs.set(runId, { ...r, segments });
    this.notify();
    if (this.qc) void this.qc.invalidateQueries({ queryKey: ["teacher-chat", r.chatId] });
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
        this.finish(runId, {
          ...r,
          text: e.data.text ?? r.text,
          segments: (e.data.segments as LiveSegment[] | undefined) ?? r.segments,
          status: e.data.status,
        });
        return;
      }
      case "question":
      case "malformed":
      case "grade":
      case "plan":
      case "hint":
        this.onBlock(runId, e);
        return;
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
/** True while a chat answer (or, with `teacher`, a teacher reply) generates in this session (or anywhere, without a key). */
export const useGenerating = (sessionKey?: string, teacher = false) => useStore((s) => s.isGenerating(sessionKey, teacher));
/** True while an answer generates in this chat (re-renders only when that changes). */
export const useChatGenerating = (chatId: string | null | undefined) => useStore((s) => isActiveStatus(s.ofChat(chatId)?.status));
export const useUnseenHere = (sessionKey?: string, teacher = false) => useStore((s) => s.hasUnseen(sessionKey, teacher));
/** The ids of the chats generating now, joined (a stable primitive snapshot). */
export function useGeneratingChats(): Set<string> {
  const joined = useStore((s) => s.generatingChats().sort().join("\n"));
  return new Set(joined ? joined.split("\n") : []);
}
