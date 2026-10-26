/**
 * 016: the restore running for this account, shared by the Backup page and the app-wide overlay
 * (contracts/ui-contract.md "Other tabs and windows"). `local` is set in the tab that confirmed
 * the restore; other tabs learn about it from a `423 restore_in_progress`.
 */
import { useSyncExternalStore } from "react";
import type { BackupJob } from "./api";

export interface RestoreWatch {
  jobId: string;
  local: boolean;
  job?: BackupJob;
}

let current: RestoreWatch | null = null;
let lastResult: BackupJob | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const restoreState = {
  get: () => current,
  watch(jobId: string, local: boolean) {
    if (current?.jobId === jobId) {
      if (local && !current.local) current = { ...current, local };
    } else {
      current = { jobId, local };
    }
    lastResult = null;
    emit();
  },
  update(job: BackupJob) {
    if (current?.jobId !== job.id) return;
    current = { ...current, job };
    emit();
  },
  finish(job: BackupJob | null) {
    lastResult = current?.local ? job : null;
    current = null;
    emit();
  },
  lastResult: () => lastResult,
  clearResult() {
    lastResult = null;
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  resetForTests() {
    current = null;
    lastResult = null;
    emit();
  },
};

export function useRestoreWatch(): RestoreWatch | null {
  return useSyncExternalStore(restoreState.subscribe, restoreState.get, restoreState.get);
}

export function useRestoreResult(): BackupJob | null {
  return useSyncExternalStore(restoreState.subscribe, restoreState.lastResult, restoreState.lastResult);
}

/** Survives the reload after a restore, so the Backup page can say it worked. */
export const DONE_KEY = "uh-restore-done";

export interface RestoreDone {
  keysLeftOut: { kind: string; name: string }[];
}

export function rememberDone(job: BackupJob) {
  try {
    sessionStorage.setItem(DONE_KEY, JSON.stringify({ keysLeftOut: job.summary?.keysLeftOut ?? [] }));
  } catch {
    /* private mode: the message is only a convenience */
  }
}

export function takeDone(): RestoreDone | null {
  try {
    const raw = sessionStorage.getItem(DONE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DONE_KEY);
    return JSON.parse(raw) as RestoreDone;
  } catch {
    return null;
  }
}
