import { describe, expect, it, vi } from "vitest";
import type { Recording } from "@/features/recordings/api";
import { MemoryChunkStore } from "@/features/recordings/chunkStore";
import { pickMime, RecorderController, TIMESLICE_MS, type RecorderDeps } from "@/features/recordings/recorder";
import { ApiError } from "@/lib/api";

class FakeTrack extends EventTarget {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
  getAudioTracks() {
    return [this.track];
  }
}

class FakeMediaRecorder extends EventTarget {
  static supported = ["audio/webm;codecs=opus", "audio/webm"];
  static last: FakeMediaRecorder | null = null;
  static isTypeSupported(t: string) {
    return FakeMediaRecorder.supported.includes(t);
  }
  state: "inactive" | "recording" = "inactive";
  timeslice?: number;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  constructor(public stream: FakeStream, public options: MediaRecorderOptions) {
    super();
    FakeMediaRecorder.last = this;
  }
  start(timeslice?: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
  stop() {
    this.state = "inactive";
    this.emit("tail"); // the last dataavailable fires before "stop"
    queueMicrotask(() => this.dispatchEvent(new Event("stop")));
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(overrides: Partial<RecorderDeps> = {}) {
  let clock = 1_000;
  const stream = new FakeStream();
  const store = new MemoryChunkStore();
  const uploaded: number[] = [];
  const api = {
    start: vi.fn(async (sessionKey: string, mimeType: string) => ({ id: "r1", sessionKey, mimeType, status: "recording" }) as Recording),
    putChunk: vi.fn(async (_id: string, seq: number) => {
      uploaded.push(seq);
      return { nextSeq: seq + 1, size: 1 };
    }),
    stop: vi.fn(async (id: string) => ({ id, status: "complete" }) as Recording),
  };
  const deps: RecorderDeps = {
    getUserMedia: vi.fn(async () => stream as unknown as MediaStream),
    MediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
    createAnalyser: () => null,
    api,
    store,
    now: () => clock,
    lowStorage: async () => false,
    ...overrides,
  };
  const r = new RecorderController(deps);
  return { r, deps, api, store, stream, uploaded, tick: (ms: number) => (clock += ms) };
}

const target = { sessionKey: "L:2026-10-05", courseId: "c1", label: "MATH 101 · 5 Oct" };

describe("RecorderController", () => {
  it("picks the first supported MIME type", () => {
    expect(pickMime(FakeMediaRecorder as unknown as typeof MediaRecorder)).toBe("audio/webm");
    const mp4Only = { isTypeSupported: (t: string) => t === "audio/mp4" } as unknown as typeof MediaRecorder;
    expect(pickMime(mp4Only)).toBe("audio/mp4");
    expect(pickMime(undefined)).toBeNull();
  });

  it("creates the server recording, then records with a 5 s timeslice and queues every chunk", async () => {
    const { r, api, store, uploaded } = setup();
    expect(await r.start(target)).toBe(true);
    expect(api.start).toHaveBeenCalledWith("L:2026-10-05", "audio/webm");
    const mr = FakeMediaRecorder.last!;
    expect(mr.timeslice).toBe(TIMESLICE_MS);
    expect(mr.options.mimeType).toBe("audio/webm;codecs=opus");
    expect(r.getSnapshot()).toMatchObject({ status: "recording", recordingId: "r1", sessionKey: "L:2026-10-05" });
    expect(await store.recordings()).toEqual([expect.objectContaining({ recordingId: "r1", stopped: false })]);
    mr.emit("a");
    mr.emit("b");
    await flush();
    expect(uploaded).toEqual([0, 1]);
  });

  it("stop flushes the last chunk and finalizes with the elapsed duration", async () => {
    const { r, api, store, uploaded, tick } = setup();
    await r.start(target);
    tick(65_000);
    await r.stop();
    await flush();
    await r.uploader.pump("r1");
    expect(uploaded).toEqual([0]); // the tail chunk
    expect(api.stop).toHaveBeenCalledWith("r1", { interrupted: false, durationMs: 65_000 });
    expect(r.getSnapshot().status).toBe("idle");
    expect(await store.recordings()).toEqual([]);
  });

  it("permission denied → error and no server recording", async () => {
    const { r, api } = setup({ getUserMedia: async () => Promise.reject(new DOMException("no", "NotAllowedError")) });
    expect(await r.start(target)).toBe(false);
    expect(r.getSnapshot()).toMatchObject({ status: "idle", error: "permission" });
    expect(api.start).not.toHaveBeenCalled();
  });

  it("no microphone and unsupported browsers get their own messages", async () => {
    const a = setup({ getUserMedia: async () => Promise.reject(new DOMException("no", "NotFoundError")) });
    await a.r.start(target);
    expect(a.r.getSnapshot().error).toBe("no-microphone");
    const b = setup({ MediaRecorder: undefined });
    await b.r.start(target);
    expect(b.r.getSnapshot().error).toBe("unsupported");
  });

  it("another active recording → in-progress, microphone released", async () => {
    const { r, stream } = setup();
    (r as unknown as { deps: RecorderDeps }).deps.api.start = async () => {
      throw new ApiError(409, "recording_in_progress", "busy");
    };
    expect(await r.start(target)).toBe(false);
    expect(r.getSnapshot().error).toBe("in-progress");
    expect(stream.track.stopped).toBe(true);
  });

  it("an unplugged microphone stops safely and keeps the audio", async () => {
    const { r, api, stream } = setup();
    await r.start(target);
    stream.track.dispatchEvent(new Event("ended"));
    await flush();
    await r.uploader.pump("r1");
    expect(r.getSnapshot()).toMatchObject({ status: "idle", error: null });
    expect(r.getSnapshot().notice).toMatch(/disconnected/);
    expect(api.stop).toHaveBeenCalledWith("r1", expect.objectContaining({ interrupted: false }));
  });

  it("recover() finalizes recordings left by a closed page as interrupted", async () => {
    const { r, api, store } = setup();
    await store.putRecording({ recordingId: "old", sessionKey: "k", courseId: "c", label: "x", startedAt: 0, stopped: false, interrupted: false });
    await store.putChunk({ recordingId: "old", seq: 0, blob: new Blob(["x"]) });
    await r.recover();
    await r.uploader.pump("old");
    expect(api.putChunk).toHaveBeenCalledWith("old", 0, expect.any(Blob));
    expect(api.stop).toHaveBeenCalledWith("old", { interrupted: true, durationMs: undefined });
  });
});
