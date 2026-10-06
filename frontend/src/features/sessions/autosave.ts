/**
 * Autosave for notes (FR-018–FR-020, SC-002; research N4).
 *
 * - Saves 800 ms after the last keystroke, at most every 2 s while typing continuously.
 * - One request in flight per note; newer text is saved right after.
 * - Until the server confirms, the latest text is kept as a local draft (localStorage), so a
 *   reload, crash or network loss never loses more than what was typed in the current instant.
 * - Network/server failures retry with backoff (1, 2, 4 … 30 s); conflicts (412 other window,
 *   409 changed/deleted outside the app) stop and wait for the user's decision.
 * - A transcript appended by the server (004) is merged at the end without a conflict: the
 *   user's unsaved text is kept and the transcript follows it (004 research B10).
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

/** What the server appended to a note (a finished transcription's `appended`). */
export interface ServerAppend {
  text: string;
  previousHash: string;
  hash: string;
  version: number;
}

type AppendListener = (noteId: string, text: string) => void;
const appendListeners = new Set<AppendListener>();

/** The editor subscribes to show merged server appends without reloading. */
export function onServerAppend(listener: AppendListener): () => void {
  appendListeners.add(listener);
  return () => appendListeners.delete(listener);
}

/** How long a save conflict that looks like "something was appended" waits for a known append. */
export const APPEND_WAIT_MS = 4000;
/** Returns true when a server append to this note may be about to be reported (and should be
 * fetched now). Without such a listener conflicts surface immediately, as in 002. */
type SuspectListener = (noteId: string) => boolean;
const suspectListeners = new Set<SuspectListener>();

/** Transcription subscribes: a save just found text appended at the end of this note. */
export function onAppendSuspected(listener: SuspectListener): () => void {
  suspectListeners.add(listener);
  return () => suspectListeners.delete(listener);
}

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
  private pendingAppends: ServerAppend[] = [];
  private appendWaiter: { current: ConflictInfo["current"]; resolve: (ok: boolean) => void } | null = null;
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
        this.applyPendingAppends(); // an append based on what was just saved
      } catch (err) {
        if (err instanceof ApiError && (err.status === 412 || err.status === 409)) {
          const current = (err.problem.current ?? {}) as ConflictInfo["current"];
          // the server only appended a known transcript, or we already merged it: not a conflict
          if (this.applyPendingAppends(current) || (current.hash === this.hash && current.version === this.version)) {
            continue;
          }
          // text was added after what we saved: maybe a transcript whose completion we haven't
          // seen yet — give it a moment before asking the user
          if (
            current.content != null &&
            current.content.length > this.savedContent.length &&
            current.content.startsWith(this.savedContent) &&
            [...suspectListeners].map((l) => l(this.noteId)).some(Boolean)
          ) {
            if (await this.waitForAppend(current)) continue;
          }
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

  // ---- server appends (004 transcription) ----------------------------------------------
  /** Merge text the server appended to this note: kept local edits stay, the text follows. */
  applyServerAppend(append: ServerAppend) {
    if (this.pendingAppends.some((a) => a.hash === append.hash)) return;
    this.pendingAppends.push(append);
    const waiter = this.appendWaiter;
    if (waiter && this.applyPendingAppends(waiter.current)) {
      this.appendWaiter = null;
      waiter.resolve(true);
      return;
    }
    if (this.status === "conflict" && this.conflict && this.applyPendingAppends(this.conflict.current)) {
      this.conflict = null; // the conflict was only this append: carry on saving
      this.set("dirty");
      void this.run();
      return;
    }
    if (this.status !== "conflict" && !this.inFlight) this.applyPendingAppends();
  }

  private waitForAppend(current: ConflictInfo["current"]): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.appendWaiter = null;
        resolve(false);
      }, APPEND_WAIT_MS);
      this.appendWaiter = {
        current,
        resolve: (ok) => {
          clearTimeout(timer);
          resolve(ok);
        },
      };
    });
  }

  /** Apply appends whose base is our saved state (or that explain a racing save's 409/412). */
  private applyPendingAppends(current?: ConflictInfo["current"]): boolean {
    let applied = false;
    for (const a of [...this.pendingAppends]) {
      const basedOnSaved = a.previousHash === this.hash;
      const explainsConflict = current?.content != null && current.content === this.savedContent + a.text;
      if (!basedOnSaved && !explainsConflict) continue;
      this.pendingAppends = this.pendingAppends.filter((x) => x !== a);
      this.savedContent += a.text;
      this.content += a.text;
      this.version = a.version;
      this.hash = a.hash;
      applied = true;
      appendListeners.forEach((l) => l(this.noteId, a.text));
    }
    if (applied && !current) {
      if (this.content === this.savedContent) {
        clearDraft(this.noteId);
        if (!this.inFlight) this.set("saved");
      } else if (!this.inFlight) {
        this.update(this.content); // save the user's kept edits on top
      }
    }
    return applied;
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
