import { describe, expect, it, vi } from "vitest";
import { MemoryChunkStore } from "@/features/recordings/chunkStore";
import { Uploader, type UploadApi } from "@/features/recordings/uploader";
import type { Recording } from "@/features/recordings/api";
import { ApiError } from "@/lib/api";

const rec = (id: string, status: Recording["status"] = "complete") => ({ id, status }) as Recording;
const blob = (s: string) => new Blob([s]);
const noSleep = () => Promise.resolve();

function fakeApi(opts: { offline?: () => boolean } = {}) {
  const server = new Map<string, number[]>();
  const stops: { id: string; body: { interrupted?: boolean; durationMs?: number } }[] = [];
  const api: UploadApi = {
    putChunk: vi.fn(async (id: string, seq: number) => {
      if (opts.offline?.()) throw new TypeError("Failed to fetch");
      const got = server.get(id) ?? [];
      const next = got.length;
      if (seq < next) return { nextSeq: next, size: 0 };
      if (seq > next) throw new ApiError(409, "chunk_gap", "gap", undefined, [], { nextSeq: next });
      got.push(seq);
      server.set(id, got);
      return { nextSeq: next + 1, size: 0 };
    }),
    stop: vi.fn(async (id: string, body) => {
      if (opts.offline?.()) throw new TypeError("Failed to fetch");
      stops.push({ id, body });
      return rec(id, body.interrupted ? "interrupted" : "complete");
    }),
  };
  return { api, server, stops };
}

describe("Uploader", () => {
  it("stores each chunk before uploading and deletes it only after the server confirmed it", async () => {
    const store = new MemoryChunkStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api: UploadApi = {
      putChunk: vi.fn(async () => {
        expect((await store.chunks("r1")).map((c) => c.seq)).toEqual([0]); // persisted first
        await gate;
        return { nextSeq: 1, size: 1 };
      }),
      stop: vi.fn(),
    };
    const u = new Uploader(store, api, noSleep);
    await u.enqueue("r1", 0, blob("a"));
    expect(await store.chunks("r1")).toHaveLength(1); // still waiting for the server
    expect(u.pendingFor("r1")).toBe(1);
    release();
    await u.pump("r1");
    expect(await store.chunks("r1")).toHaveLength(0);
    expect(u.pendingFor("r1")).toBe(0);
  });

  it("keeps chunks queued while offline and retries with backoff until delivered", async () => {
    const store = new MemoryChunkStore();
    let offline = true;
    const waits: number[] = [];
    const { api, server } = fakeApi({ offline: () => offline });
    const u = new Uploader(store, api, async (ms) => {
      waits.push(ms);
      if (waits.length === 3) offline = false;
    });
    await store.putChunk({ recordingId: "r1", seq: 0, blob: blob("a") });
    await store.putChunk({ recordingId: "r1", seq: 1, blob: blob("b") });
    await u.pump("r1");
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(server.get("r1")).toEqual([0, 1]);
    expect(await store.chunks("r1")).toHaveLength(0);
  });

  it("caps the backoff at 30 s", async () => {
    const store = new MemoryChunkStore();
    let n = 0;
    const waits: number[] = [];
    const { api } = fakeApi({ offline: () => n < 8 });
    const u = new Uploader(store, api, async (ms) => {
      waits.push(ms);
      n++;
    });
    await store.putChunk({ recordingId: "r1", seq: 0, blob: blob("a") });
    await u.pump("r1");
    expect(Math.max(...waits)).toBe(30_000);
  });

  it("recovery after a reload uploads leftovers in order, then stops as interrupted", async () => {
    const store = new MemoryChunkStore();
    const { api, server, stops } = fakeApi();
    for (const s of [2, 0, 1]) await store.putChunk({ recordingId: "r1", seq: s, blob: blob(String(s)) });
    await store.putRecording({
      recordingId: "r1", sessionKey: "L:2026-10-05", courseId: "c", label: "x", startedAt: 0,
      stopped: true, interrupted: true,
    });
    const finalized = vi.fn();
    const u = new Uploader(store, api, noSleep);
    u.onFinalized = finalized;
    await u.pump("r1");
    expect(server.get("r1")).toEqual([0, 1, 2]);
    expect(stops).toEqual([{ id: "r1", body: { interrupted: true, durationMs: undefined } }]);
    expect(await store.recordings()).toEqual([]);
    expect(finalized).toHaveBeenCalledWith(expect.objectContaining({ status: "interrupted" }), expect.objectContaining({ sessionKey: "L:2026-10-05" }));
  });

  it("does not finalize a recording that is still being recorded", async () => {
    const store = new MemoryChunkStore();
    const { api, stops } = fakeApi();
    await store.putRecording({ recordingId: "r1", sessionKey: "k", courseId: "c", label: "x", startedAt: 0, stopped: false, interrupted: false });
    const u = new Uploader(store, api, noSleep);
    await u.enqueue("r1", 0, blob("a"));
    await u.pump("r1");
    expect(stops).toEqual([]);
    expect(await store.recordings()).toHaveLength(1);
  });

  it("drops chunks the server already has (chunk_gap ahead) and gives up on chunks it no longer needs", async () => {
    const store = new MemoryChunkStore();
    const { api, server } = fakeApi();
    server.set("r1", [0, 1]); // uploaded before the page closed, deletion didn't happen
    await store.putChunk({ recordingId: "r1", seq: 1, blob: blob("b") });
    await store.putChunk({ recordingId: "r1", seq: 2, blob: blob("c") });
    const u = new Uploader(store, api, noSleep);
    await u.pump("r1");
    expect(server.get("r1")).toEqual([0, 1, 2]);
    expect(await store.chunks("r1")).toHaveLength(0);

    const finished: UploadApi = {
      putChunk: vi.fn(async () => {
        throw new ApiError(409, "recording_finished", "finished");
      }),
      stop: vi.fn(),
    };
    const store2 = new MemoryChunkStore();
    await store2.putChunk({ recordingId: "r2", seq: 5, blob: blob("z") });
    await new Uploader(store2, finished, noSleep).pump("r2");
    expect(await store2.chunks("r2")).toHaveLength(0);
  });
});
