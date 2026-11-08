/**
 * 024: simulated chat / teacher runs (research R5, specs/014 contracts/chat-stream.md). A run plays
 * a script of events on a timer whether or not anyone listens, like the real server; each event is
 * applied to the stored answer before it is sent, so a reload shows the text so far. The events
 * endpoint replays the buffer after `lastEventId` and then follows the run until a terminal event.
 */
import type { Schemas } from "@/lib/api";
import type { RunEvent } from "@/lib/api/stream";

export type Status = Schemas["AnswerOut"]["status"];
type Ev = { [K in RunEvent["type"]]: { type: K; data: Extract<RunEvent, { type: K }>["data"] } }[RunEvent["type"]];
export type Step = Exclude<Ev, { type: "start" | "done" | "stopped" | "interrupted" | "failed" | "snapshot" }>;

export const STEP_MS = 30;
const TERMINAL = new Set(["done", "stopped", "interrupted", "failed"]); // event types
const ENDED = new Set<Status>(["completed", "stopped", "interrupted", "failed"]); // run statuses

export interface Run {
  id: string;
  chatId: string;
  sessionKey: string;
  turnId: string;
  answerId: string;
  teacher: boolean;
  status: Status;
  events: { id: number; type: string; data: unknown }[];
  /** Applies an event to the stored chat (text, status, questions…) before it is sent. */
  apply: (ev: Ev) => void;
  pending: Step[];
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
}

const runs = new Map<string, Run>();

export const getRun = (id: string) => runs.get(id);
export const activeRuns = () => [...runs.values()].filter((r) => !ENDED.has(r.status));
export const activeRunFor = (chatId: string) => activeRuns().find((r) => r.chatId === chatId);
export const clearRuns = () => {
  for (const r of runs.values()) if (r.timer) clearTimeout(r.timer);
  runs.clear();
};

export const runOut = (r: Run): Schemas["ChatRunOut"] => ({
  id: r.id,
  chatId: r.chatId,
  sessionKey: r.sessionKey,
  answerId: r.answerId,
  status: r.status,
  teacher: r.teacher,
});

/** Split prose into deltas of two words each (whitespace kept, so the text rebuilds exactly). */
export function deltas(text: string): Step[] {
  const words = text.match(/\s*\S+\s*/g) ?? [];
  const out: Step[] = [];
  for (let i = 0; i < words.length; i += 2) out.push({ type: "delta", data: { text: words.slice(i, i + 2).join("") } });
  return out;
}

export function usageOf(question: string, answer: string): Step {
  const input = Math.ceil(question.length / 4) + 120;
  const output = Math.ceil(answer.length / 4);
  return { type: "usage", data: { input, output, total: input + output } };
}

function emit(run: Run, ev: Ev): void {
  run.apply(ev);
  if (ev.type === "start" || ev.type === "delta") run.status = "streaming";
  if (TERMINAL.has(ev.type)) {
    run.status = (ev.data as { status: Status }).status;
    run.pending = [];
    if (run.timer) clearTimeout(run.timer);
    run.timer = null;
  }
  run.events.push({ id: run.events.length + 1, type: ev.type, data: ev.data });
  for (const l of [...run.listeners]) l();
}

function tick(run: Run): void {
  run.timer = null;
  const next = run.pending.shift();
  if (!next) {
    emit(run, { type: "done", data: { status: "completed", endedAt: new Date().toISOString() } });
    return;
  }
  emit(run, next);
  run.timer = setTimeout(() => tick(run), STEP_MS);
}

export interface StartRun {
  id: string;
  chatId: string;
  sessionKey: string;
  turnId: string;
  answerId: string;
  teacher: boolean;
  endpointLabel: string;
  modelLabel: string;
  locality: "local" | "remote";
  steps: Step[];
  apply: Run["apply"];
}

/** Start a run: `start` now, then one step every STEP_MS, then `done`. */
export function startRun(o: StartRun): Run {
  const run: Run = { ...o, status: "queued", events: [], pending: [...o.steps], timer: null, listeners: new Set() };
  runs.set(run.id, run);
  const { id: runId, chatId, turnId, answerId, endpointLabel, modelLabel, locality } = o;
  emit(run, { type: "start", data: { runId, chatId, turnId, answerId, endpointLabel, modelLabel, locality } });
  run.timer = setTimeout(() => tick(run), STEP_MS);
  return run;
}

/** Stop: no further delta; the text so far stays. Idempotent. */
export function stopRun(run: Run): void {
  if (ENDED.has(run.status)) return;
  emit(run, { type: "stopped", data: { status: "stopped", endedAt: new Date().toISOString() } });
}

const frame = (e: Run["events"][number]) => `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`;

/** The `text/event-stream` response for a run, resuming after `lastEventId`. */
export function eventStream(run: Run, lastEventId: number): Response {
  const enc = new TextEncoder();
  let sent = lastEventId;
  let listener: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const flush = () => {
        for (const e of run.events) {
          if (e.id <= sent) continue;
          sent = e.id;
          controller.enqueue(enc.encode(frame(e)));
        }
        if (ENDED.has(run.status)) {
          if (listener) run.listeners.delete(listener);
          controller.close();
          return true;
        }
        return false;
      };
      if (!flush()) {
        listener = () => void flush();
        run.listeners.add(listener);
      }
    },
    cancel() {
      if (listener) run.listeners.delete(listener);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
