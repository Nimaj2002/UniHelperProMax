/**
 * The one recorder of the app (FR-003, research A5). Lives outside React so navigating anywhere
 * never stops it; the workspace panel and the global recording bar render its state.
 */
import { useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api";
import { putChunk, startRecording, stopRecording, type Recording } from "./api";
import { chunkStore, lowDeviceStorage, type ChunkStore } from "./chunkStore";
import { Uploader } from "./uploader";

export const TIMESLICE_MS = 5000;

export type RecorderStatus = "idle" | "starting" | "recording" | "stopping";
export type RecorderError = "permission" | "no-microphone" | "unsupported" | "in-progress" | "device-lost" | "failed";

export interface RecorderState {
  status: RecorderStatus;
  recordingId: string | null;
  sessionKey: string | null;
  courseId: string | null;
  label: string | null;
  startedAt: number | null;
  error: RecorderError | null;
  /** Set briefly after the microphone disappeared mid-recording (audio kept). */
  notice: string | null;
}

export interface RecorderDeps {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder: typeof MediaRecorder | undefined;
  createAnalyser?: (stream: MediaStream) => { level(): number; close(): void } | null;
  api: {
    start: typeof startRecording;
    putChunk: typeof putChunk;
    stop: typeof stopRecording;
  };
  store: ChunkStore;
  now: () => number;
  lowStorage: () => Promise<boolean>;
}

const idle: RecorderState = {
  status: "idle", recordingId: null, sessionKey: null, courseId: null, label: null, startedAt: null,
  error: null, notice: null,
};

function webAudioAnalyser(stream: MediaStream) {
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    return {
      level() {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        return Math.min(1, Math.sqrt(sum / buf.length) * 4);
      },
      close() {
        void ctx.close();
      },
    };
  } catch {
    return null;
  }
}

export function pickMime(MR: typeof MediaRecorder | undefined): "audio/webm" | "audio/mp4" | null {
  if (!MR) return null;
  if (MR.isTypeSupported?.("audio/webm;codecs=opus")) return "audio/webm";
  if (MR.isTypeSupported?.("audio/webm")) return "audio/webm";
  if (MR.isTypeSupported?.("audio/mp4")) return "audio/mp4";
  return null;
}

export class RecorderController {
  private state: RecorderState = idle;
  private listeners = new Set<() => void>();
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private analyser: { level(): number; close(): void } | null = null;
  private seq = 0;
  private stopped: Promise<void> | null = null;
  readonly uploader: Uploader;
  onWarning?: (message: string) => void;
  onFinished?: (rec: Recording, sessionKey: string) => void;

  constructor(private deps: RecorderDeps) {
    this.uploader = new Uploader(deps.store, { putChunk: deps.api.putChunk, stop: deps.api.stop });
    this.uploader.onFinalized = (rec, meta) => this.onFinished?.(rec, meta.sessionKey);
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.state;
  private set(patch: Partial<RecorderState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  get active(): boolean {
    return this.state.status === "recording" || this.state.status === "starting" || this.state.status === "stopping";
  }

  /** Input level 0–1 for the meter (polled by the UI). */
  level(): number {
    return this.analyser?.level() ?? 0;
  }

  clearError() {
    this.set({ error: null, notice: null });
  }

  async start(target: { sessionKey: string; courseId: string | null; label: string }): Promise<boolean> {
    if (this.state.status !== "idle") return false;
    const mime = pickMime(this.deps.MediaRecorder);
    if (!mime || !this.deps.MediaRecorder) {
      this.set({ error: "unsupported" });
      return false;
    }
    this.set({ ...idle, status: "starting", sessionKey: target.sessionKey, courseId: target.courseId, label: target.label });
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException)?.name;
      this.set({ ...idle, error: name === "NotFoundError" || name === "OverconstrainedError" ? "no-microphone" : name === "NotAllowedError" || name === "SecurityError" ? "permission" : "failed" });
      return false;
    }
    let rec: Recording;
    try {
      rec = await this.deps.api.start(target.sessionKey, mime);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      this.set({ ...idle, error: err instanceof ApiError && err.code === "recording_in_progress" ? "in-progress" : "failed" });
      return false;
    }
    const startedAt = this.deps.now();
    await this.deps.store.putRecording({
      recordingId: rec.id, sessionKey: target.sessionKey, courseId: target.courseId, label: target.label,
      startedAt, stopped: false, interrupted: false,
    });
    if (!this.deps.store.persistent) this.onWarning?.("This browser can't store audio on the device, so crash protection is reduced.");
    this.stream = stream;
    this.seq = 0;
    const MR = this.deps.MediaRecorder;
    const recorder = new MR(stream, { mimeType: mime === "audio/webm" ? "audio/webm;codecs=opus" : "audio/mp4", audioBitsPerSecond: 48_000 });
    this.recorder = recorder;
    recorder.ondataavailable = (e: BlobEvent) => {
      if (!e.data || e.data.size === 0) return;
      const seq = this.seq++;
      void this.deps.lowStorage().then((low) => low && this.onWarning?.("Your device is almost out of storage for pending audio. Reconnect so it can upload."));
      void this.uploader.enqueue(rec.id, seq, e.data);
    };
    stream.getAudioTracks().forEach((t) =>
      t.addEventListener("ended", () => {
        if (this.state.status === "recording") {
          this.set({ notice: "The microphone was disconnected. Everything recorded so far was kept." });
          void this.stop("device-lost");
        }
      }),
    );
    this.analyser = this.deps.createAnalyser ? this.deps.createAnalyser(stream) : webAudioAnalyser(stream);
    recorder.start(TIMESLICE_MS);
    this.set({ status: "recording", recordingId: rec.id, startedAt });
    return true;
  }

  stop(reason?: RecorderError): Promise<void> {
    if (this.stopped) return this.stopped;
    if (this.state.status !== "recording") return Promise.resolve();
    const { recordingId, startedAt } = this.state;
    this.set({ status: "stopping" });
    const recorder = this.recorder;
    this.stopped = new Promise<void>((resolve) => {
      const finish = async () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.analyser?.close();
        this.analyser = null;
        this.stream = null;
        this.recorder = null;
        const meta = (await this.deps.store.recordings()).find((r) => r.recordingId === recordingId);
        if (meta) {
          await this.deps.store.putRecording({ ...meta, stopped: true, interrupted: false, durationMs: this.deps.now() - (startedAt ?? this.deps.now()) });
        }
        this.set({ ...idle, notice: this.state.notice, error: reason === "device-lost" ? null : this.state.error });
        this.stopped = null;
        if (recordingId) void this.uploader.pump(recordingId);
        resolve();
      };
      if (recorder && recorder.state !== "inactive") {
        recorder.addEventListener("stop", () => void finish(), { once: true });
        recorder.stop(); // emits the last dataavailable before "stop"
      } else {
        void finish();
      }
    });
    return this.stopped;
  }

  /** After a reload/crash: deliver leftover audio and finalize those recordings (US2). */
  async recover(): Promise<void> {
    for (const meta of await this.deps.store.recordings()) {
      if (meta.recordingId === this.state.recordingId) continue;
      if (!meta.stopped) {
        await this.deps.store.putRecording({ ...meta, stopped: true, interrupted: true });
      }
      void this.uploader.pump(meta.recordingId);
    }
  }
}

let shared: RecorderController | null = null;

export function recorder(): RecorderController {
  if (!shared) {
    shared = new RecorderController({
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
      MediaRecorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
      api: { start: startRecording, putChunk, stop: stopRecording },
      store: chunkStore(),
      now: () => Date.now(),
      lowStorage: lowDeviceStorage,
    });
  }
  return shared;
}

export function useRecorderState(r: RecorderController = recorder()): RecorderState {
  return useSyncExternalStore(r.subscribe, r.getSnapshot, r.getSnapshot);
}
