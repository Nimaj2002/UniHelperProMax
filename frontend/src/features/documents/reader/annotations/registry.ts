/**
 * Open documents' annotation queues, for the leave guards (007 FR-029): the browser's
 * `beforeunload`, sign-out, and closing a document tab while changes are still being saved.
 */
import type { OpQueue } from "./opQueue";

const queues = new Map<string, OpQueue>();

export function registerQueue(documentId: string, q: OpQueue) {
  queues.set(documentId, q);
  return () => {
    if (queues.get(documentId) === q) queues.delete(documentId);
  };
}

export const anyPendingAnnotations = () => [...queues.values()].some((q) => q.hasPending());

/** Try to save now; resolves true when nothing is left unsaved for this document. */
export async function flushAnnotations(documentId: string, timeoutMs = 2000): Promise<boolean> {
  const q = queues.get(documentId);
  if (!q?.hasPending()) return true;
  await Promise.race([q.flush(), new Promise((r) => setTimeout(r, timeoutMs))]);
  return !q.hasPending();
}
