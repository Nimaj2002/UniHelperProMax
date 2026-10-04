/**
 * Autosave for notes (FR-018–FR-020, SC-002; research N4).
 *
 * - Saves 800 ms after the last keystroke, at most every 2 s while typing continuously.
 * - One request in flight per note; newer text is saved right after.
 * - Until the server confirms, the latest text is kept as a local draft (localStorage), so a
 *   reload, crash or network loss never loses more than what was typed in the current instant.
 * - Network/server failures retry with backoff (1, 2, 4 … 30 s); conflicts (412 other window,
 *   409 changed/deleted outside the app) stop and wait for the user's decision.
 */
import { useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface ConflictInfo {
  kind: "version" | "changed" | "missing";
  current: { version: number; hash: string; content: string | null };
}

export interface SaveResponse {
  version: number;
  hash: string;
}

export type SaveFn = (
  noteId: string,
  content: string,
  version: number,
  baseHash: string,
  keepalive?: boolean,
) => Promise<SaveResponse>;

export interface Draft {
  baseVersion: number;
  content: string;
  savedAt: number;
}

export const DEBOUNCE_MS = 800;
export const MAX_WAIT_MS = 2000;
const MAX_BACKOFF_MS = 30_000;
const draftKey = (id: string) => `uh.draft.${id}`;

export function readDraft(noteId: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(noteId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(noteId: string, draft: Draft) {
  try {
    window.localStorage.setItem(draftKey(noteId), JSON.stringify(draft));
  } catch {
    /* storage full or blocked: the server save is still attempted */
  }
}

export function clearDraft(noteId: string) {
  try {
    window.localStorage.removeItem(draftKey(noteId));
  } catch {
    /* ignore */
  }
}

export class NoteSaver {
  readonly noteId: string;
  status: SaveStatus = "saved";
  version: number;
  hash: string;
  content: string;
  conflict: ConflictInfo | null = null;
  lastSavedAt: number | null = null;
  private savedContent: string;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt: number | null = null;
  private inFlight: Promise<void> | null = null;
  private backoff = 1000;
  private listeners = new Set<() => void>();
  private readonly save: SaveFn;
  private snapshotCache: { status: SaveStatus; conflict: ConflictInfo | null; lastSavedAt: number | null } | null = null;

  constructor(noteId: string, initial: { content: string; version: number; hash: string }, save: SaveFn) {
    this.noteId = noteId;
    this.content = this.savedContent = initial.content;
    this.version = initial.version;
    this.hash = initial.hash;
    this.save = save;
  }

  // ---- observation -------------------------------------------------------------------
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => {
    if (
      !this.snapshotCache ||
      this.snapshotCache.status !== this.status ||
      this.snapshotCache.conflict !== this.conflict ||
      this.snapshotCache.lastSavedAt !== this.lastSavedAt
    ) {
      this.snapshotCache = { status: this.status, conflict: this.conflict, lastSavedAt: this.lastSavedAt };
    }
    return this.snapshotCache;
  };

  private set(status: SaveStatus) {
    this.status = status;
    this.listeners.forEach((l) => l());
  }

  get pending(): boolean {
    return this.status !== "saved";
  }

  // ---- editing -----------------------------------------------------------------------
  update(content: string) {
    this.content = content;
    if (this.status === "conflict") {
      writeDraft(this.noteId, { baseVersion: this.version, content, savedAt: Date.now() });
      return;
    }
    if (content === this.savedContent && !this.inFlight) {
      this.clearTimers();
      this.firstDirtyAt = null;
      clearDraft(this.noteId);
      this.set("saved");
      return;
    }
    writeDraft(this.noteId, { baseVersion: this.version, content, savedAt: Date.now() });
    if (this.status !== "error") this.set(this.inFlight ? "saving" : "dirty");
    this.firstDirtyAt ??= Date.now();
    if (this.debounce) clearTimeout(this.debounce);
    const waited = Date.now() - this.firstDirtyAt;
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited));
    this.debounce = setTimeout(() => void this.run(), delay);
  }

  /** Save now and resolve when nothing is pending (or a failure/conflict stops it). */
  async flush(): Promise<void> {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    if (this.status === "conflict") return;
    if (this.content === this.savedContent && !this.inFlight) return;
    await this.run();
  }

  /** Best-effort save that survives page unload (small bodies only). */
  flushOnUnload() {
    if (this.content === this.savedContent || this.status === "conflict") return;
    void this.save(this.noteId, this.content, this.version, this.hash, true).catch(() => {});
  }

  private clearTimers() {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.retry) clearTimeout(this.retry);
    this.debounce = this.retry = null;
  }

  private run(): Promise<void> {
    if (this.inFlight) return this.inFlight.then(() => this.flush());
    this.clearTimers();
    this.inFlight = this.loop().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async loop(): Promise<void> {
    while (this.content !== this.savedContent) {
      const text = this.content;
      this.set("saving");
      try {
        const res = await this.save(this.noteId, text, this.version, this.hash);
        this.version = res.version;
        this.hash = res.hash;
        this.savedContent = text;
        this.backoff = 1000;
        this.lastSavedAt = Date.now();
      } catch (err) {
        if (err instanceof ApiError && (err.status === 412 || err.status === 409)) {
          const current = (err.problem.current ?? {}) as ConflictInfo["current"];
          const kind = err.code === "file_missing" ? "missing" : err.status === 412 ? "version" : "changed";
          this.conflict = { kind, current };
          this.set("conflict");
          return;
        }
        this.set("error");
        this.retry = setTimeout(() => void this.run(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
        return;
      }
    }
    this.firstDirtyAt = null;
    clearDraft(this.noteId);
    this.set("saved");
  }

  // ---- conflict resolution (ConflictDialog) ---------------------------------------------
  /** Overwrite the other version with this text. */
  async useMine(): Promise<void> {
    if (!this.conflict) return;
    this.version = this.conflict.current.version;
    this.hash = this.conflict.current.hash;
    this.conflict = null;
    this.set("dirty");
    await this.run();
  }

  /** Replace this text with the other version. Returns the text to show in the editor. */
  useTheirs(): string {
    if (!this.conflict) return this.content;
    const { current } = this.conflict;
    this.version = current.version;
    this.hash = current.hash;
    this.content = this.savedContent = current.content ?? "";
    this.conflict = null;
    clearDraft(this.noteId);
    this.set("saved");
    return this.content;
  }

  /** A local draft based on an older version than the server's: let the user decide. */
  markDraftConflict(draft: string, current: ConflictInfo["current"]) {
    this.content = draft;
    this.conflict = { kind: "version", current };
    this.set("conflict");
  }

  /** After "Keep both" saved this text as a new note: adopt the other version here. */
  adoptTheirsAfterCopy(): string {
    return this.useTheirs();
  }

  dispose() {
    this.clearTimers();
    this.listeners.clear();
  }
}

// ---- registry: one saver per open note, page-level guards ----------------------------------

const savers = new Map<string, NoteSaver>();

export function getSaver(noteId: string): NoteSaver | undefined {
  return savers.get(noteId);
}

export function ensureSaver(
  noteId: string,
  initial: { content: string; version: number; hash: string },
  save: SaveFn,
): NoteSaver {
  let s = savers.get(noteId);
  if (!s) {
    s = new NoteSaver(noteId, initial, save);
    savers.set(noteId, s);
    installPageGuards();
  }
  return s;
}

export function removeSaver(noteId: string) {
  savers.get(noteId)?.dispose();
  savers.delete(noteId);
}

export function hasUnsaved(): boolean {
  return [...savers.values()].some((s) => s.pending);
}

export async function flushAll(): Promise<boolean> {
  await Promise.all([...savers.values()].map((s) => s.flush()));
  return !hasUnsaved();
}

let guardsInstalled = false;
function installPageGuards() {
  if (guardsInstalled || typeof window === "undefined") return;
  guardsInstalled = true;
  window.addEventListener("beforeunload", (e) => {
    if (hasUnsaved()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => savers.forEach((s) => s.flushOnUnload()));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAll();
  });
}

export function useSaveStatus(saver: NoteSaver | undefined) {
  return useSyncExternalStore(
    saver ? saver.subscribe : () => () => {},
    saver ? saver.getSnapshot : () => null,
    saver ? saver.getSnapshot : () => null,
  );
}

/** Test helper: forget all savers. */
export function resetSaversForTests() {
  savers.forEach((s) => s.dispose());
  savers.clear();
}
