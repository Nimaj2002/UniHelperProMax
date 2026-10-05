/**
 * Ordered, resumable upload of recorded chunks (research A2/A3). Chunks are read from the device
 * store, sent in order, and deleted only after the server confirmed them. When a recording is
 * marked stopped and every chunk is delivered, the final stop is sent.
 */
import { useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api";
import type { Recording } from "./api";
import type { ChunkStore, StoredRecording } from "./chunkStore";

export interface UploadApi {
  putChunk(id: string, seq: number, blob: Blob): Promise<{ nextSeq: number; size: number }>;
  stop(id: string, body: { interrupted?: boolean; durationMs?: number }): Promise<Recording>;
}

const MAX_BACKOFF = 30_000;

export class Uploader {
  private running = new Map<string, Promise<void>>();
  private pending = new Map<string, number>();
  private listeners = new Set<() => void>();
  private snapshot = new Map<string, number>();
  private backoff = new Map<string, number>();
  onFinalized?: (rec: Recording, meta: StoredRecording) => void;

  constructor(private store: ChunkStore, private api: UploadApi, private sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snapshot;
  private emit() {
    this.snapshot = new Map(this.pending);
    this.listeners.forEach((l) => l());
  }

  pendingFor(id: string): number {
    return this.pending.get(id) ?? 0;
  }

  get anyPending(): boolean {
    return [...this.pending.values()].some((n) => n > 0);
  }

  async enqueue(recordingId: string, seq: number, blob: Blob) {
    await this.store.putChunk({ recordingId, seq, blob });
    this.pending.set(recordingId, (this.pending.get(recordingId) ?? 0) + 1);
    this.emit();
    void this.pump(recordingId);
  }

  /** Upload everything stored for a recording (and finalize if it was stopped). */
  pump(recordingId: string): Promise<void> {
    const existing = this.running.get(recordingId);
    if (existing) return existing.then(() => this.drainAgainIfNeeded(recordingId));
    const p = this.run(recordingId).finally(() => this.running.delete(recordingId));
    this.running.set(recordingId, p);
    return p;
  }

  private async drainAgainIfNeeded(id: string) {
    if ((await this.store.chunks(id)).length) await this.pump(id);
  }

  private async run(id: string): Promise<void> {
    for (;;) {
      const chunks = await this.store.chunks(id);
      this.pending.set(id, chunks.length);
      this.emit();
      if (!chunks.length) break;
      const c = chunks[0];
      try {
        await this.api.putChunk(id, c.seq, c.blob);
        await this.store.deleteChunk(id, c.seq);
        this.backoff.delete(id);
      } catch (err) {
        if (err instanceof ApiError && err.code === "chunk_gap") {
          const next = Number(err.problem.nextSeq ?? 0);
          if (next > c.seq) await this.store.deleteChunk(id, c.seq); // server already has it
          else if (!chunks.some((x) => x.seq === next)) return; // a missing chunk can't be recovered
          continue;
        }
        if (err instanceof ApiError && (err.code === "recording_finished" || err.status === 404)) {
          for (const x of chunks) await this.store.deleteChunk(id, x.seq);
          continue;
        }
        const wait = this.backoff.get(id) ?? 1000;
        this.backoff.set(id, Math.min(wait * 2, MAX_BACKOFF));
        await this.sleep(wait);
      }
    }
    await this.finalizeIfStopped(id);
  }

  private async finalizeIfStopped(id: string) {
    const meta = (await this.store.recordings()).find((r) => r.recordingId === id);
    if (!meta?.stopped) return;
    for (;;) {
      try {
        const rec = await this.api.stop(id, { interrupted: meta.interrupted, durationMs: meta.durationMs });
        await this.store.deleteRecording(id);
        this.pending.delete(id);
        this.emit();
        this.onFinalized?.(rec, meta);
        return;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          await this.store.deleteRecording(id);
          return;
        }
        const wait = this.backoff.get(id) ?? 1000;
        this.backoff.set(id, Math.min(wait * 2, MAX_BACKOFF));
        await this.sleep(wait);
      }
    }
  }
}

export function usePendingUploads(u: Uploader): Map<string, number> {
  return useSyncExternalStore(u.subscribe, u.getSnapshot, u.getSnapshot);
}
