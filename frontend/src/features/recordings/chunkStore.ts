/**
 * Device-side holding area for recorded audio (FR-008, research A2): every chunk is stored here
 * before upload and removed only after the server confirmed it, so a crash or network loss keeps
 * the audio until it can be delivered.
 */

export interface StoredChunk {
  recordingId: string;
  seq: number;
  blob: Blob;
}

export interface StoredRecording {
  recordingId: string;
  sessionKey: string;
  courseId: string | null; // 009: null for an event
  label: string;
  startedAt: number;
  /** Set when the recorder stopped (or a crashed page was found): finalize after the upload. */
  stopped: boolean;
  interrupted: boolean;
  durationMs?: number;
}

export interface ChunkStore {
  readonly persistent: boolean;
  putChunk(c: StoredChunk): Promise<void>;
  chunks(recordingId: string): Promise<StoredChunk[]>;
  deleteChunk(recordingId: string, seq: number): Promise<void>;
  putRecording(r: StoredRecording): Promise<void>;
  recordings(): Promise<StoredRecording[]>;
  deleteRecording(recordingId: string): Promise<void>;
}

export class MemoryChunkStore implements ChunkStore {
  readonly persistent = false;
  private c = new Map<string, StoredChunk>();
  private r = new Map<string, StoredRecording>();
  async putChunk(x: StoredChunk) {
    this.c.set(`${x.recordingId}|${x.seq}`, x);
  }
  async chunks(id: string) {
    return [...this.c.values()].filter((x) => x.recordingId === id).sort((a, b) => a.seq - b.seq);
  }
  async deleteChunk(id: string, seq: number) {
    this.c.delete(`${id}|${seq}`);
  }
  async putRecording(x: StoredRecording) {
    this.r.set(x.recordingId, { ...x });
  }
  async recordings() {
    return [...this.r.values()];
  }
  async deleteRecording(id: string) {
    this.r.delete(id);
  }
}

const DB = "uh-recordings";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IdbChunkStore implements ChunkStore {
  readonly persistent = true;
  private db: Promise<IDBDatabase>;

  constructor() {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("chunks", { keyPath: ["recordingId", "seq"] });
        open.result.createObjectStore("recordings", { keyPath: "recordingId" });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  private async store(name: "chunks" | "recordings", mode: IDBTransactionMode) {
    return (await this.db).transaction(name, mode).objectStore(name);
  }

  async putChunk(c: StoredChunk) {
    await req((await this.store("chunks", "readwrite")).put(c));
  }
  async chunks(id: string) {
    const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
    return (await req((await this.store("chunks", "readonly")).getAll(range))) as StoredChunk[];
  }
  async deleteChunk(id: string, seq: number) {
    await req((await this.store("chunks", "readwrite")).delete([id, seq]));
  }
  async putRecording(r: StoredRecording) {
    await req((await this.store("recordings", "readwrite")).put(r));
  }
  async recordings() {
    return (await req((await this.store("recordings", "readonly")).getAll())) as StoredRecording[];
  }
  async deleteRecording(id: string) {
    await req((await this.store("recordings", "readwrite")).delete(id));
  }
}

let shared: ChunkStore | null = null;

/** IndexedDB when available; in-memory otherwise (crash protection reduced — UI warns). */
export function chunkStore(): ChunkStore {
  if (!shared) {
    try {
      shared = typeof indexedDB !== "undefined" ? new IdbChunkStore() : new MemoryChunkStore();
    } catch {
      shared = new MemoryChunkStore();
    }
  }
  return shared;
}

export function setChunkStoreForTests(s: ChunkStore) {
  shared = s;
}

/** Warn when the device has less than ~2 h of audio left (A6). */
export async function lowDeviceStorage(): Promise<boolean> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.quota || est.usage === undefined) return false;
    return est.quota - est.usage < 50 * 1024 * 1024;
  } catch {
    return false;
  }
}
