/**
 * Audio uploads, kept outside React so they continue while the user moves around the app
 * (006 FR-005, FR-006, FR-012; data-model "Upload"). At most two upload at once; each file has
 * its own progress, cancel and result.
 */
import { useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api";
import { importAudio, type Recording } from "@/features/recordings/api";
import { checkAudioFile, probeDuration, tooLargeMessage, unsupportedTypeMessage, type FileProblem } from "./audioFiles";

export type UploadState = "checking" | "queued" | "uploading" | "verifying" | "done" | "cancelled" | "failed" | "rejected";

export interface UploadEntry {
  id: string;
  batchId: string;
  sessionKey: string;
  fileName: string;
  size: number;
  state: UploadState;
  loaded: number;
  total: number;
  error?: FileProblem;
  /** Network and server-side failures can be retried; rejections of the file itself can't. */
  retryable: boolean;
  recordingId?: string;
}

export interface UploadEvent {
  type: "start" | "progress" | "done" | "cancelled" | "failed" | "rejected";
  entry: UploadEntry;
  percent?: number;
}

export interface BatchResult {
  fileName: string;
  outcome: "imported" | "cancelled" | "failed" | "rejected";
  detail?: string;
}

export type UploadFn = (
  sessionKey: string,
  file: File,
  durationMs: number | undefined,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
) => Promise<Recording>;

interface Internal {
  entry: UploadEntry;
  file: File;
  durationMs?: number;
  controller?: AbortController;
  lastQuarter: number;
}

const FINAL: UploadState[] = ["done", "cancelled", "failed", "rejected"];

/** Read through a function: `cancel()` changes the state while an upload is awaited. */
const cancelled = (item: Internal) => item.entry.state === "cancelled";

/** The message a person sees for a failed upload (contracts/ui-import.md). */
export function uploadErrorMessage(err: unknown, fileName: string, size: number): FileProblem & { retryable: boolean } {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "unsupported_type":
        return { code: err.code, message: unsupportedTypeMessage(fileName), retryable: false };
      case "file_too_large":
        return { code: err.code, message: tooLargeMessage(fileName, size), retryable: false };
      case "unreadable_audio":
        return { code: err.code, message: `${fileName} couldn't be read as audio.`, retryable: false };
      case "insufficient_storage":
        return { code: err.code, message: `There isn't enough space on the server for ${fileName}.`, retryable: true };
      case "not_found":
        return { code: err.code, message: `${fileName} wasn't uploaded: this session no longer exists.`, retryable: false };
      default:
        if (err.status === 0 || err.status >= 500 || err.code === "incomplete_upload") {
          return { code: err.code, message: `Upload of ${fileName} failed — check your connection.`, retryable: true };
        }
        return { code: err.code, message: `${fileName} wasn't uploaded: ${err.title}`, retryable: false };
    }
  }
  return { code: "network_error", message: `Upload of ${fileName} failed — check your connection.`, retryable: true };
}

export class ImportQueue {
  private items = new Map<string, Internal>();
  private order: string[] = [];
  private snapshot: UploadEntry[] = [];
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: UploadEvent) => void>();
  private batches = new Map<string, { ids: string[]; results: Map<string, BatchResult> }>();
  private lastEmit = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  onUploaded?: (sessionKey: string, recording: Recording) => void;
  onBatchSettled?: (sessionKey: string, results: BatchResult[]) => void;

  constructor(
    private upload: UploadFn = importAudio,
    private probe: (file: File) => Promise<number | undefined> = probeDuration,
    private readonly concurrency = 2,
    private readonly renderIntervalMs = 250,
    private now: () => number = () => Date.now(),
  ) {}

  // ---- observation ---------------------------------------------------------------------
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snapshot;

  onEvent(l: (e: UploadEvent) => void): () => void {
    this.eventListeners.add(l);
    return () => {
      this.eventListeners.delete(l);
    };
  }

  /** Re-render now, or — for progress — at most every `renderIntervalMs` (≤ 4/s). */
  private emit(throttled = false) {
    if (throttled) {
      const wait = this.lastEmit + this.renderIntervalMs - this.now();
      if (wait > 0) {
        this.emitTimer ??= setTimeout(() => {
          this.emitTimer = null;
          this.emit();
        }, wait);
        return;
      }
    }
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.lastEmit = this.now();
    this.snapshot = this.order.map((id) => ({ ...this.items.get(id)!.entry }));
    this.listeners.forEach((l) => l());
  }

  private fire(type: UploadEvent["type"], item: Internal, percent?: number) {
    const e = { type, entry: { ...item.entry }, percent };
    this.eventListeners.forEach((l) => l(e));
  }

  entries(sessionKey?: string): UploadEntry[] {
    return sessionKey ? this.snapshot.filter((e) => e.sessionKey === sessionKey) : this.snapshot;
  }

  hasActiveUploads(): boolean {
    return [...this.items.values()].some((i) => !FINAL.includes(i.entry.state));
  }

  // ---- commands --------------------------------------------------------------------------
  /** Check, then queue each file. Rejected files never cause a request (SC-002). */
  enqueue(sessionKey: string, files: File[]): string {
    const batchId = `b${++this.seq}`;
    const ids: string[] = [];
    for (const file of files) {
      const id = `u${++this.seq}`;
      const problem = checkAudioFile(file);
      const item: Internal = {
        file,
        lastQuarter: 0,
        entry: {
          id,
          batchId,
          sessionKey,
          fileName: file.name,
          size: file.size,
          state: problem ? "rejected" : "checking",
          loaded: 0,
          total: file.size,
          error: problem ?? undefined,
          retryable: false,
        },
      };
      this.items.set(id, item);
      this.order.push(id);
      ids.push(id);
    }
    this.batches.set(batchId, { ids, results: new Map() });
    this.emit();
    for (const id of ids) {
      const item = this.items.get(id)!;
      if (item.entry.state === "rejected") {
        this.fire("rejected", item);
        this.settle(item);
        continue;
      }
      void this.probe(item.file)
        .catch(() => undefined)
        .then((ms) => {
          if (item.entry.state !== "checking") return; // cancelled meanwhile
          item.durationMs = ms;
          item.entry.state = "queued";
          this.emit();
          this.pump();
        });
    }
    return batchId;
  }

  cancel(id: string) {
    const item = this.items.get(id);
    if (!item || FINAL.includes(item.entry.state)) return;
    const wasRunning = item.entry.state === "uploading" || item.entry.state === "verifying";
    item.entry.state = "cancelled";
    item.controller?.abort();
    this.fire("cancelled", item);
    this.settle(item);
    this.remove(id);
    if (wasRunning) this.pump();
  }

  cancelAll() {
    [...this.order].forEach((id) => this.cancel(id));
  }

  retry(id: string) {
    const item = this.items.get(id);
    if (!item || item.entry.state !== "failed" || !item.entry.retryable) return;
    item.entry = { ...item.entry, state: "queued", loaded: 0, error: undefined, retryable: false };
    item.lastQuarter = 0;
    const batch = this.batches.get(item.entry.batchId);
    batch?.results.delete(id);
    this.emit();
    this.pump();
  }

  dismiss(id: string) {
    const item = this.items.get(id);
    if (!item || !FINAL.includes(item.entry.state)) return;
    this.remove(id);
  }

  // ---- internals -------------------------------------------------------------------------
  private remove(id: string) {
    this.items.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.emit();
  }

  private running(): number {
    return [...this.items.values()].filter((i) => i.entry.state === "uploading" || i.entry.state === "verifying").length;
  }

  private pump() {
    for (const id of this.order) {
      if (this.running() >= this.concurrency) return;
      const item = this.items.get(id)!;
      if (item.entry.state === "queued") void this.run(item);
    }
  }

  private async run(item: Internal) {
    const controller = new AbortController();
    item.controller = controller;
    item.entry.state = "uploading";
    this.emit();
    this.fire("start", item);
    try {
      const rec = await this.upload(
        item.entry.sessionKey,
        item.file,
        item.durationMs,
        (loaded, total) => {
          if (item.entry.state !== "uploading") return;
          item.entry.loaded = loaded;
          item.entry.total = total || item.entry.size;
          if (loaded >= item.entry.total) item.entry.state = "verifying";
          const quarter = Math.floor((loaded / (item.entry.total || 1)) * 4);
          if (quarter > item.lastQuarter && quarter < 4) {
            item.lastQuarter = quarter;
            this.fire("progress", item, quarter * 25);
          }
          this.emit(true);
        },
        controller.signal,
      );
      if (cancelled(item)) return; // cancel() already reported it
      item.entry.state = "done";
      item.entry.recordingId = rec.id;
      this.fire("done", item);
      this.onUploaded?.(item.entry.sessionKey, rec);
      this.settle(item);
      this.remove(item.entry.id);
    } catch (err) {
      if (cancelled(item)) return; // cancel() already reported it
      const problem = uploadErrorMessage(err, item.entry.fileName, item.entry.size);
      item.entry.state = "failed";
      item.entry.error = { code: problem.code, message: problem.message };
      item.entry.retryable = problem.retryable;
      this.fire("failed", item);
      this.settle(item);
      this.emit();
    } finally {
      item.controller = undefined;
      this.pump();
    }
  }

  private settle(item: Internal) {
    const outcome: BatchResult["outcome"] =
      item.entry.state === "done" ? "imported" : (item.entry.state as "cancelled" | "failed" | "rejected");
    const result: BatchResult = { fileName: item.entry.fileName, outcome, detail: item.entry.error?.message };
    const batch = this.batches.get(item.entry.batchId);
    if (!batch) {
      this.onBatchSettled?.(item.entry.sessionKey, [result]); // a retry after its batch was reported
      return;
    }
    batch.results.set(item.entry.id, result);
    if (batch.results.size === batch.ids.length) {
      this.batches.delete(item.entry.batchId);
      this.onBatchSettled?.(item.entry.sessionKey, batch.ids.map((id) => batch.results.get(id)!));
    }
  }
}

let shared: ImportQueue | null = null;

/** The app-wide queue (module-level, so uploads survive navigation). */
export function importQueue(): ImportQueue {
  shared ??= new ImportQueue();
  return shared;
}

export function useImportQueue(sessionKey: string, queue: ImportQueue = importQueue()): UploadEntry[] {
  const all = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  return all.filter((e) => e.sessionKey === sessionKey);
}
