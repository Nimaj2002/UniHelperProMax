/**
 * 016: notice when the signed-in account's data was replaced by a restore (research R11).
 *
 * Every authenticated response carries `X-Data-Epoch: <userId>.<epoch>`. When the epoch of the
 * same account changes, the data under this page is gone: tell the student and reload. A
 * `423 restore_in_progress` means a restore is running right now; listeners (the restore
 * overlay) show it until it ends.
 */

type Listener = (jobId: string) => void;

let known: { user: string; epoch: string } | undefined;
let reloading = false;
let suppressed = false;
const restoreListeners = new Set<Listener>();
let replacedListener: (() => void) | undefined;

/** Called with each response's `X-Data-Epoch` header. */
export function noteDataEpoch(value: string | null | undefined): void {
  if (!value) return;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return;
  const user = value.slice(0, dot);
  const epoch = value.slice(dot + 1);
  if (!known || known.user !== user) {
    known = { user, epoch }; // first response, or another account signed in
    return;
  }
  if (known.epoch === epoch) return;
  known = { user, epoch };
  if (suppressed || reloading) return;
  reloading = true;
  replacedListener?.();
}

/** The tab that runs a restore reloads by itself once it's done. */
export function suppressEpochReload(on = true): void {
  suppressed = on;
}

/** What to do when the data was replaced (the app shows a toast and reloads). */
export function onDataReplaced(listener: () => void): () => void {
  replacedListener = listener;
  return () => {
    if (replacedListener === listener) replacedListener = undefined;
  };
}

export function noteRestoreInProgress(jobId: unknown): void {
  if (typeof jobId !== "string" || !jobId) return;
  restoreListeners.forEach((l) => l(jobId));
}

export function onRestoreInProgress(listener: Listener): () => void {
  restoreListeners.add(listener);
  return () => {
    restoreListeners.delete(listener);
  };
}

export function resetDataEpochForTests(): void {
  known = undefined;
  reloading = false;
  suppressed = false;
  restoreListeners.clear();
  replacedListener = undefined;
}
