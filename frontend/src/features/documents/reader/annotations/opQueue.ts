/**
 * Annotation saving (007 FR-028/FR-029, research R7): every change becomes an operation that is
 * stored on the device (IndexedDB `uh-annotations`, store `ops`, key `[documentId, seq]`) before it
 * is sent, and removed only after the server's result. Sent 500 ms after the last change and at
 * most 2 s after the first; on failure retried with backoff up to 30 s. A reloaded or crashed page
 * sends what was left on the next open (`restore`).
 */
import { ApiError } from "@/lib/api";
import type { SaveStatus } from "./saveState";
import type { AnnotationOp, OpResult } from "./types";

export interface PendingOp {
  documentId: string;
  seq: number;
  op: AnnotationOp;
}

export interface OpStore {
  readonly persistent: boolean;
  put(p: PendingOp): Promise<void>;
  list(documentId: string): Promise<PendingOp[]>;
  delete(documentId: string, seq: number): Promise<void>;
}

export class MemoryOpStore implements OpStore {
  readonly persistent = false;
  private items = new Map<string, PendingOp>();
  async put(p: PendingOp) {
    this.items.set(`${p.documentId}|${p.seq}`, structuredClone(p));
  }
  async list(documentId: string) {
    return [...this.items.values()].filter((p) => p.documentId === documentId).sort((a, b) => a.seq - b.seq);
  }
  async delete(documentId: string, seq: number) {
    this.items.delete(`${documentId}|${seq}`);
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IdbOpStore implements OpStore {
  readonly persistent = true;
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open("uh-annotations", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("ops", { keyPath: ["documentId", "seq"] });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  private async ops(mode: IDBTransactionMode) {
    return (await this.db).transaction("ops", mode).objectStore("ops");
  }
  async put(p: PendingOp) {
    await req((await this.ops("readwrite")).put(p));
  }
  async list(documentId: string) {
    const range = IDBKeyRange.bound([documentId, 0], [documentId, Number.MAX_SAFE_INTEGER]);
    return (await req((await this.ops("readonly")).getAll(range))) as PendingOp[];
  }
  async delete(documentId: string, seq: number) {
    await req((await this.ops("readwrite")).delete([documentId, seq]));
  }
}

let shared: OpStore | null = null;

/** IndexedDB when available; in memory otherwise (the reader warns: changes can be lost on a crash). */
export function opStore(): OpStore {
  if (!shared) {
    try {
      shared = typeof indexedDB !== "undefined" ? new IdbOpStore() : new MemoryOpStore();
    } catch {
      shared = new MemoryOpStore();
    }
  }
  return shared;
}

export interface OpsResponse {
  results: OpResult[];
  notice: string | null;
}
export type Sender = (documentId: string, ops: AnnotationOp[]) => Promise<OpsResponse>;

const DEBOUNCE = 500;
const MAX_WAIT = 2000;
const BATCH = 200;
const RETRY_FIRST = 1000;
const RETRY_MAX = 30_000;

/** A refusal that retrying can't fix (validation, limits, document gone). */
const refused = (err: unknown) => err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;

interface Options {
  documentId: string;
  store: OpStore;
  send: Sender;
  onResults?: (results: OpResult[]) => void;
  /** `unreadable_file_moved`, or the code of a refused batch (e.g. `too_many_annotations`). */
  onNotice?: (notice: string) => void;
}

export class OpQueue {
  status: SaveStatus = "saved";
  private ops: PendingOp[] = [];
  private seq = 0;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private maxWait: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = RETRY_FIRST;
  private sending: Promise<void> | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();

  constructor(private readonly o: Options) {}

  get persistent() {
    return this.o.store.persistent;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  hasPending() {
    return this.ops.length > 0 || this.sending !== null;
  }

  private setStatus(s: SaveStatus) {
    if (s === this.status) return;
    this.status = s;
    this.listeners.forEach((l) => l());
  }

  /** Ops left by an earlier page (crash, reload, offline close); sent right away. */
  async restore(): Promise<PendingOp[]> {
    const left = await this.o.store.list(this.o.documentId);
    this.seq = Math.max(this.seq, ...left.map((p) => p.seq));
    const known = new Set(this.ops.map((p) => p.seq));
    this.ops = [...left.filter((p) => !known.has(p.seq)), ...this.ops].sort((a, b) => a.seq - b.seq);
    if (this.ops.length) {
      this.setStatus("pending");
      this.debounce = setTimeout(() => void this.flush(), 0);
    }
    return left;
  }

  async enqueue(op: AnnotationOp) {
    const p: PendingOp = { documentId: this.o.documentId, seq: ++this.seq, op };
    await this.o.store.put(p); // on the device before it is sent
    this.ops.push(p);
    if (this.status !== "error") this.setStatus(this.sending ? "saving" : "pending");
    if (this.retry) return; // joins the next retry
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.flush(), DEBOUNCE);
    this.maxWait ??= setTimeout(() => void this.flush(), MAX_WAIT);
  }

  /** Send what is pending now (also used when the tab closes). */
  async flush(): Promise<void> {
    clearTimeout(this.debounce);
    clearTimeout(this.maxWait);
    clearTimeout(this.retry);
    this.debounce = this.maxWait = this.retry = undefined;
    if (this.disposed) return;
    if (this.sending) return this.sending;
    if (!this.ops.length) return;
    this.sending = this.sendBatch().finally(() => {
      this.sending = null;
    });
    await this.sending;
    if (this.ops.length && !this.retry && !this.disposed) await this.flush();
  }

  private async sendBatch() {
    const batch = this.ops.slice(0, BATCH);
    if (this.status !== "error") this.setStatus("saving");
    let response: OpsResponse | null = null;
    try {
      response = await this.o.send(
        this.o.documentId,
        batch.map((p) => p.op),
      );
    } catch (err) {
      if (!refused(err)) {
        this.setStatus("error");
        this.retry = setTimeout(() => void this.flush(), this.retryDelay);
        this.retryDelay = Math.min(RETRY_MAX, this.retryDelay * 2);
        return;
      }
      this.o.onNotice?.((err as ApiError).code);
    }
    if (this.disposed && response === null) return;
    this.retryDelay = RETRY_FIRST;
    const sent = new Set(batch.map((p) => p.seq));
    this.ops = this.ops.filter((p) => !sent.has(p.seq));
    await Promise.all(batch.map((p) => this.o.store.delete(p.documentId, p.seq)));
    if (response) {
      this.o.onResults?.(response.results);
      if (response.notice) this.o.onNotice?.(response.notice);
    }
    this.setStatus(this.ops.length ? "pending" : "saved");
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.debounce);
    clearTimeout(this.maxWait);
    clearTimeout(this.retry);
    this.listeners.clear();
  }
}
