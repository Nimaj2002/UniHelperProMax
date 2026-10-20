/**
 * 014: a chat run's event stream (contracts/chat-stream.md), read with the native `EventSource`
 * (same-origin cookies, no CSRF for a GET). The browser's own reconnects send `Last-Event-ID`;
 * when the connection closes for good, this reconnects with a backoff and drops any event it has
 * already seen, so a replay never duplicates text. The stream is closed after a terminal event,
 * which keeps the browser from reconnecting to a finished run.
 */
import { API_BASE, type Schemas } from "./client";

export type RunStatus = Schemas["AnswerOut"]["status"];
export type RunError = Schemas["AnswerError"];
export type RunUsage = Schemas["Usage"];

export type RunEvent =
  | {
      type: "start";
      data: { runId: string; chatId: string; turnId: string; answerId: string; endpointLabel: string; modelLabel: string; locality?: "local" | "remote" | null };
    }
  | { type: "delta"; data: { text: string } }
  | { type: "usage"; data: RunUsage }
  | { type: "snapshot"; data: { text: string; status: RunStatus } }
  | { type: "done"; data: { status: "completed"; usage?: RunUsage | null; endedAt?: string } }
  | { type: "stopped"; data: { status: "stopped"; endedAt?: string } }
  | { type: "interrupted"; data: { status: "interrupted" } }
  | { type: "failed"; data: { status: "failed"; error: RunError } };

export type RunEventType = RunEvent["type"];
export const TERMINAL_EVENTS: ReadonlySet<RunEventType> = new Set(["done", "stopped", "interrupted", "failed"]);
const EVENT_TYPES: RunEventType[] = ["start", "delta", "usage", "snapshot", "done", "stopped", "interrupted", "failed"];

export interface SubscribeOptions {
  /** Events up to this id were already handled (a resumed subscription). */
  lastEventId?: number;
  onEvent: (event: RunEvent, id: number) => void;
  /** The stream gave up after repeated failures (the run is unknown or the server is gone). */
  onGiveUp?: () => void;
  /** Reconnect delays in ms; the last one repeats until `maxRetries`. */
  backoff?: number[];
  maxRetries?: number;
}

export const runEventsUrl = (runId: string, lastEventId = 0) =>
  `${API_BASE}/chat-runs/${encodeURIComponent(runId)}/events${lastEventId ? `?lastEventId=${lastEventId}` : ""}`;

/** Subscribe to a run's events; returns the unsubscribe function (it never affects the run). */
export function subscribeRun(runId: string, opts: SubscribeOptions): () => void {
  const backoff = opts.backoff ?? [500, 1000, 2000, 5000, 10_000];
  const maxRetries = opts.maxRetries ?? 8;
  let last = opts.lastEventId ?? 0;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let closed = false;

  const close = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    source?.close();
    source = null;
  };

  const connect = () => {
    if (closed) return;
    const es = new EventSource(runEventsUrl(runId, last), { withCredentials: true });
    source = es;
    const handle = (type: RunEventType) => (e: MessageEvent<string>) => {
      const id = Number(e.lastEventId) || 0;
      // a replay (a reconnect the server couldn't resume) repeats events already handled
      if (id && id <= last && type !== "snapshot") return;
      if (id) last = Math.max(last, id);
      failures = 0;
      let data: unknown;
      try {
        data = e.data ? JSON.parse(e.data) : {};
      } catch {
        return;
      }
      const ev = { type, data } as RunEvent;
      // a snapshot replaces the buffer that expired: nothing follows it on this connection
      const ends = TERMINAL_EVENTS.has(type) || type === "snapshot";
      if (ends) close();
      opts.onEvent(ev, id);
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, handle(t) as EventListener);
    es.onerror = () => {
      if (closed || source !== es) return;
      // CONNECTING: the browser retries by itself, sending Last-Event-ID
      if (es.readyState !== EventSource.CLOSED) return;
      es.close();
      source = null;
      failures += 1;
      if (failures > maxRetries) {
        close();
        opts.onGiveUp?.();
        return;
      }
      timer = setTimeout(connect, backoff[Math.min(failures - 1, backoff.length - 1)]);
    };
  };

  connect();
  return close;
}
