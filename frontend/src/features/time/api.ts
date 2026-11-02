/**
 * Time tracking API (020): the one running timer, entries and tags.
 *
 * The server holds the timer (research R1). Each timer response carries `serverNow`, from which a
 * clock offset is kept (R2). Start, stop and pause go through an outbox (R5): the moment the user
 * acted is recorded and the request is retried until the server confirms, so no time is lost when
 * the server can't be reached. Other windows hear about changes on a BroadcastChannel (R12).
 */
import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch, type Schemas } from "@/lib/api";
import { readLocal, writeLocal } from "@/lib/storage";
import { unlockSound } from "./alerts";
import { serverOffset } from "./clock";

export type Timer = Schemas["TimerOut"];
export type TimerResponse = Schemas["TimerResponse"];
export type Entry = Schemas["EntryOut"];
export type Tag = Schemas["TagOut"];
export type Undo = Schemas["Undo"];
/** `POST /time/timer/start`; the server fills the defaults. */
export type TimerStart = Partial<Schemas["TimerStart"]> & Pick<Schemas["TimerStart"], "style">;
export type EntryCreate = Schemas["EntryCreate"];
export type EntryPatch = Schemas["EntryPatch"];
export type Overlap = Schemas["Overlap"];

export const timeKeys = {
  all: ["time"] as const,
  timer: ["time", "timer"] as const,
  entries: ["time", "entries"] as const,
  range: (from: string, to: string, sessionKey?: string) => ["time", "entries", from, to, sessionKey ?? null] as const,
  tags: ["time", "tags"] as const,
};
const UNDO_MS = 10_000;

// ---- server clock offset --------------------------------------------------------------------

let offset = 0;
/** Server minus local clock, in ms (research R2). */
export const clockOffset = () => offset;
/** Now on the server's clock. */
export const serverNow = () => Date.now() + offset;

// ---- cross-window sync (research R12) --------------------------------------------------------

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("uh-time");

/** Tell other windows that time data changed. */
export function broadcast() {
  channel?.postMessage("changed");
}

/** Refetch on other windows' changes, on focus and when the page becomes visible. */
export function startSync(qc: QueryClient): () => void {
  const refresh = () => void qc.invalidateQueries({ queryKey: timeKeys.all });
  const onVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  if (channel) channel.onmessage = refresh;
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", refresh);
  return () => {
    if (channel) channel.onmessage = null;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", refresh);
  };
}

// ---- responses ------------------------------------------------------------------------------

const timeOfDay = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const PHASE: Record<string, string> = { work: "Work", short_break: "Short break", long_break: "Long break" };

/** Store a timer response: the offset, the timer, and fresh entries when one was saved. */
function receive(qc: QueryClient, res: TimerResponse, sentAt: number) {
  offset = serverOffset(res.serverNow, sentAt, Date.now());
  qc.setQueryData(timeKeys.timer, res.timer ?? null);
  if (res.saved || res.settled.length) void qc.invalidateQueries({ queryKey: timeKeys.entries });
  for (const s of res.settled) {
    // FR-025: a phase that ended while the app was closed
    toast(`${s.phase ? PHASE[s.phase] : "Focus session"} finished at ${timeOfDay(s.finishedAt)}`);
  }
}

async function timerFetch(path: string, opts: { method?: "GET" | "POST" | "PATCH"; body?: unknown; version?: number } = {}) {
  const sentAt = Date.now();
  return { res: await apiFetch<TimerResponse>(`/time/timer${path}`, { method: opts.method ?? "POST", ...opts }), sentAt };
}

export function useTimer() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: timeKeys.timer,
    queryFn: async () => {
      const { res, sentAt } = await timerFetch("", { method: "GET" });
      receive(qc, res, sentAt);
      return res.timer ?? null;
    },
    refetchInterval: 30_000, // other devices (research R12); paused while the page is hidden
    refetchOnWindowFocus: true,
  });
}

// ---- the outbox (research R5) ---------------------------------------------------------------

interface OutboxItem {
  id: string;
  path: "/start" | "/stop" | "/pause";
  body: Record<string, unknown>;
  /** The timer version it expects; null → the version current when it is sent (after a start). */
  version: number | null;
}

const OUTBOX_KEY = "uh.time.outbox";
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];
let outbox: OutboxItem[] = readLocal<OutboxItem[]>(OUTBOX_KEY, []);
let attempt = 0;
let timerId: number | undefined;
const outboxListeners = new Set<() => void>();

function setOutbox(next: OutboxItem[]) {
  outbox = next;
  writeLocal(OUTBOX_KEY, next);
  outboxListeners.forEach((l) => l());
}

const retryable = (err: unknown) => err instanceof ApiError && (err.status === 0 || err.status >= 500);

/** Send queued writes in order; stop at the first that still can't reach the server. */
export async function flushOutbox(qc: QueryClient): Promise<void> {
  window.clearTimeout(timerId);
  while (outbox.length) {
    const item = outbox[0]!;
    const version = item.version ?? qc.getQueryData<Timer | null>(timeKeys.timer)?.version;
    try {
      const { res, sentAt } = await timerFetch(item.path, { body: item.body, version: item.path === "/start" ? undefined : version });
      receive(qc, res, sentAt);
      broadcast();
      if (res.undo) {
        undoToast(qc, item.path === "/start" ? "The previous timer was stopped and saved." : "Not saved: under 5 seconds.", res.undo);
      }
      toast.dismiss("time-retrying");
    } catch (err) {
      if (retryable(err)) {
        toast("Not saved yet — retrying.", { id: "time-retrying", duration: Infinity });
        timerId = window.setTimeout(() => void flushOutbox(qc), RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
        return;
      }
      // the timer changed elsewhere meanwhile: this write no longer applies
      toast.error(err instanceof ApiError ? err.title : "Couldn't save the timer change.");
      void qc.invalidateQueries({ queryKey: timeKeys.timer });
    }
    attempt = 0;
    setOutbox(outbox.slice(1));
  }
}

/** Number of timer writes not yet saved on the server. */
export function usePendingWrites(): number {
  return useSyncExternalStore(
    (l) => (outboxListeners.add(l), () => outboxListeners.delete(l)),
    () => outbox.length,
    () => 0,
  );
}

/** Retry the outbox on reconnect and focus; call once (TimeHost). */
export function startOutbox(qc: QueryClient): () => void {
  const flush = () => {
    attempt = 0;
    void flushOutbox(qc);
  };
  window.addEventListener("online", flush);
  window.addEventListener("focus", flush);
  if (outbox.length) flush();
  return () => {
    window.removeEventListener("online", flush);
    window.removeEventListener("focus", flush);
  };
}

/** Queue a start/stop/pause with the moment the user acted, update the cache at once, send it. */
function enqueue(qc: QueryClient, path: OutboxItem["path"], body: Record<string, unknown>) {
  const current = qc.getQueryData<Timer | null>(timeKeys.timer) ?? null;
  const at = new Date(serverNow()).toISOString();
  const pendingStart = outbox.some((i) => i.path === "/start");
  setOutbox([...outbox, { id: crypto.randomUUID(), path, body: { ...body, at }, version: pendingStart ? null : (current?.version ?? null) }]);
  return flushOutbox(qc);
}

// ---- timer actions --------------------------------------------------------------------------

function undoToast(qc: QueryClient, message: string, undo: Undo) {
  toast(message, {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: () => {
        const current = qc.getQueryData<Timer | null>(timeKeys.timer);
        timerFetch("/undo", { body: { undo, timerVersion: current?.version ?? null } })
          .then(({ res, sentAt }) => {
            receive(qc, res, sentAt);
            void qc.invalidateQueries({ queryKey: timeKeys.entries });
            broadcast();
          })
          .catch(() => toast.error("This can no longer be undone."));
      },
    },
  });
}

export function useTimerActions() {
  const qc = useQueryClient();
  const run = async (path: string, opts: { body?: unknown; method?: "POST" | "PATCH" } = {}) => {
    const t = qc.getQueryData<Timer | null>(timeKeys.timer);
    try {
      const { res, sentAt } = await timerFetch(path, { ...opts, version: t?.version });
      receive(qc, res, sentAt);
      broadcast();
      return res;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 412 || err.status === 409)) {
        void qc.invalidateQueries({ queryKey: timeKeys.timer });
      }
      toast.error(err instanceof ApiError ? err.title : "Couldn't update the timer.");
      throw err;
    }
  };
  return {
    // start, stop and pause carry the user's moment and are retried (research R5)
    start: (body: TimerStart) => {
      unlockSound(); // a user gesture: lets the end-of-phase sound play later (research R4)
      return enqueue(qc, "/start", { ...body });
    },
    stop: () => enqueue(qc, "/stop", {}),
    pause: () => enqueue(qc, "/pause", {}),
    resume: () => run("/resume"),
    advance: () => run("/advance"),
    skip: () => run("/skip"),
    reset: () => run("/reset"),
    extend: () => run("/extend"),
    setEnd: (endedAt: string) => run("/set-end", { body: { endedAt } }),
    patch: (body: Schemas["TimerPatch"]) => run("", { method: "PATCH", body }),
  };
}

// ---- entries --------------------------------------------------------------------------------

export function useEntries(from: string, to: string, sessionKey?: string, enabled = true) {
  return useQuery({
    queryKey: timeKeys.range(from, to, sessionKey),
    queryFn: () => apiFetch<Entry[]>("/time/entries", { query: { from, to, sessionKey } }),
    enabled,
  });
}

function entriesChanged(qc: QueryClient) {
  broadcast();
  return qc.invalidateQueries({ queryKey: timeKeys.entries });
}

export function useCreateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EntryCreate) => apiFetch<Schemas["EntryWithOverlaps"]>("/time/entries", { method: "POST", body }),
    onSuccess: () => entriesChanged(qc),
  });
}

export function usePatchEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entry, patch }: { entry: Entry; patch: EntryPatch }) =>
      apiFetch<Schemas["EntryWithOverlaps"]>(`/time/entries/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: patch, version: entry.version }),
    onSuccess: () => entriesChanged(qc),
  });
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: Entry) => apiFetch<void>(`/time/entries/${encodeURIComponent(entry.id)}`, { method: "DELETE" }),
    onSuccess: (_v, entry) => {
      void entriesChanged(qc);
      // FR-018: Undo for at least 10 seconds
      toast("Entry deleted.", {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () =>
            void apiFetch<Entry>(`/time/entries/${encodeURIComponent(entry.id)}/restore`, { method: "POST" })
              .then(() => entriesChanged(qc))
              .catch(() => toast.error("Couldn't restore the entry.")),
        },
      });
    },
    onError: () => toast.error("Couldn't delete the entry."),
  });
}

// ---- tags -----------------------------------------------------------------------------------

export function useTags() {
  return useQuery({ queryKey: timeKeys.tags, queryFn: () => apiFetch<Tag[]>("/time/tags"), staleTime: 60_000 });
}

function tagsChanged(qc: QueryClient) {
  broadcast();
  return qc.invalidateQueries({ queryKey: timeKeys.all });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["TagCreate"]) => apiFetch<Tag>("/time/tags", { method: "POST", body }),
    onSuccess: () => tagsChanged(qc),
  });
}

export function usePatchTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tag, patch }: { tag: Tag; patch: Schemas["TagPatch"] }) =>
      apiFetch<Tag>(`/time/tags/${encodeURIComponent(tag.id)}`, { method: "PATCH", body: patch, version: tag.version }),
    onSuccess: () => tagsChanged(qc),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tag: Tag) => apiFetch<void>(`/time/tags/${encodeURIComponent(tag.id)}`, { method: "DELETE" }),
    onSuccess: () => tagsChanged(qc),
  });
}
