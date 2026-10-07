import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recording } from "@/features/recordings/api";
import { ImportQueue, type BatchResult, type UploadFn, type UploadEvent } from "@/features/imports/importQueue";
import { ApiError } from "@/lib/api";

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name);
const flush = () => new Promise((r) => setTimeout(r, 0));

interface Call {
  sessionKey: string;
  file: File;
  durationMs?: number;
  progress: (loaded: number, total: number) => void;
  signal: AbortSignal;
  resolve: (r: Recording) => void;
  reject: (e: unknown) => void;
}

function fakeUpload() {
  const calls: Call[] = [];
  const upload: UploadFn = vi.fn(
    (sessionKey, f, durationMs, progress, signal) =>
      new Promise<Recording>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        calls.push({ sessionKey, file: f, durationMs, progress, signal, resolve, reject });
      }),
  );
  return { upload, calls };
}

const rec = (id: string) => ({ id }) as Recording;

describe("ImportQueue", () => {
  afterEach(() => vi.useRealTimers());

  it("uploads two files at a time and queues the rest", async () => {
    const { upload, calls } = fakeUpload();
    const q = new ImportQueue(upload, async () => 1234);
    q.enqueue("s1", [file("a.mp3"), file("b.wav"), file("c.flac")]);
    await flush();
    expect(calls.map((c) => c.file.name)).toEqual(["a.mp3", "b.wav"]);
    expect(q.entries("s1").map((e) => e.state)).toEqual(["uploading", "uploading", "queued"]);
    expect(calls[0].durationMs).toBe(1234);

    calls[0].resolve(rec("r1"));
    await flush();
    expect(calls.map((c) => c.file.name)).toEqual(["a.mp3", "b.wav", "c.flac"]);
    expect(q.entries("s1").map((e) => e.fileName)).toEqual(["b.wav", "c.flac"]); // done rows leave
  });

  it("reports progress, throttled to at most 4 renders a second", async () => {
    vi.useFakeTimers();
    let now = 0;
    const { upload, calls } = fakeUpload();
    const q = new ImportQueue(upload, async () => undefined, 2, 250, () => now);
    const renders = vi.fn();
    q.subscribe(renders);
    q.enqueue("s1", [file("a.mp3", 1000)]);
    await vi.advanceTimersByTimeAsync(0);
    renders.mockClear();

    for (let i = 1; i <= 20; i++) {
      now += 50; // 20 progress events in one second
      calls[0].progress(i * 40, 1000);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(renders.mock.calls.length).toBeLessThanOrEqual(5);
    expect(q.entries("s1")[0].loaded).toBe(800);
  });

  it("announces start, every quarter, and the result", async () => {
    const { upload, calls } = fakeUpload();
    const q = new ImportQueue(upload, async () => undefined);
    const events: UploadEvent[] = [];
    q.onEvent((e) => events.push(e));
    q.enqueue("s1", [file("a.mp3", 1000)]);
    await flush();
    for (const loaded of [100, 260, 510, 520, 760, 999]) calls[0].progress(loaded, 1000);
    calls[0].resolve(rec("r1"));
    await flush();
    expect(events.map((e) => (e.type === "progress" ? `p${e.percent}` : e.type))).toEqual(["start", "p25", "p50", "p75", "done"]);
  });

  it("cancel aborts a running upload, removes it and starts the next one", async () => {
    const { upload, calls } = fakeUpload();
    const q = new ImportQueue(upload, async () => undefined, 1);
    const settled: BatchResult[][] = [];
    q.onBatchSettled = (_s, r) => settled.push(r);
    q.enqueue("s1", [file("a.mp3"), file("b.mp3")]);
    await flush();
    const [a, b] = q.entries("s1");
    q.cancel(a.id);
    expect(calls[0].signal.aborted).toBe(true);
    await flush();
    expect(q.entries("s1").map((e) => e.fileName)).toEqual(["b.mp3"]);
    expect(calls).toHaveLength(2);

    calls[1].resolve(rec("r2"));
    await flush();
    expect(settled).toEqual([[{ fileName: "a.mp3", outcome: "cancelled", detail: undefined }, { fileName: "b.mp3", outcome: "imported", detail: undefined }]]);
    expect(b.state).toBe("queued");
  });

  it("cancel on a queued file never opens a request", async () => {
    const { upload, calls } = fakeUpload();
    const q = new ImportQueue(upload, async () => undefined, 1);
    q.enqueue("s1", [file("a.mp3"), file("b.mp3")]);
    await flush();
    q.cancel(q.entries("s1")[1].id);
    calls[0].resolve(rec("r1"));
    await flush();
    expect(calls).toHaveLength(1);
    expect(q.hasActiveUploads()).toBe(false);
  });

  it("calls onUploaded with the new recording so lists can refresh", async () => {
    const { upload, calls } = fakeUpload();
    const q = new ImportQueue(upload, async () => undefined);
    const uploaded = vi.fn();
    q.onUploaded = uploaded;
    q.enqueue("s1", [file("a.mp3")]);
    await flush();
    calls[0].resolve(rec("r1"));
    await flush();
    expect(uploaded).toHaveBeenCalledWith("s1", rec("r1"));
  });

  it("a network failure can be retried; a rejected file only dismissed", async () => {
    const { upload, calls } = fakeUpload();
    const q = new ImportQueue(upload, async () => undefined);
    q.enqueue("s1", [file("a.mp3"), file("b.mp3")]);
    await flush();
    calls[0].reject(new ApiError(0, "network_error", "Can't reach the server."));
    calls[1].reject(new ApiError(422, "unreadable_audio", "nope"));
    await flush();
    const [a, b] = q.entries("s1");
    expect(a).toMatchObject({ state: "failed", retryable: true, error: { code: "network_error" } });
    expect(b).toMatchObject({ state: "failed", retryable: false, error: { code: "unreadable_audio" } });

    q.retry(b.id);
    q.retry(a.id);
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2].file.name).toBe("a.mp3");
    q.dismiss(b.id);
    expect(q.entries("s1").map((e) => e.fileName)).toEqual(["a.mp3"]);
  });

  it("keeps entries per session across navigation (module-level store)", async () => {
    const { upload } = fakeUpload();
    const q = new ImportQueue(upload, async () => undefined);
    q.enqueue("s1", [file("a.mp3")]);
    q.enqueue("s2", [file("b.mp3")]);
    await flush();
    expect(q.entries("s1").map((e) => e.fileName)).toEqual(["a.mp3"]);
    expect(q.entries("s2").map((e) => e.fileName)).toEqual(["b.mp3"]);
    expect(q.hasActiveUploads()).toBe(true);
    q.cancelAll();
    expect(q.hasActiveUploads()).toBe(false);
  });
});
