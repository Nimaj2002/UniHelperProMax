/**
 * 023: signals from existing success/error paths that a hands-on tour step waits for
 * (research R4). Emitting is free when no tour runs and never throws into the caller.
 */
export type TourEventMap = {
  "class.created": { courseId: string };
  "note.created": { noteId: string };
  "note.saved": undefined;
  "document.added": undefined;
  "recording.started": undefined;
  "recording.saved": undefined;
  "chat.sent": undefined;
  "action.failed": { kind: "class" | "note" | "upload" | "recording" | "chat" };
};
export type TourEventName = keyof TourEventMap;
type Listener<K extends TourEventName> = (payload: TourEventMap[K]) => void;

const listeners = new Map<TourEventName, Set<Listener<never>>>();

export const tourEvents = {
  emit<K extends TourEventName>(name: K, ...[payload]: TourEventMap[K] extends undefined ? [] : [TourEventMap[K]]) {
    for (const fn of [...(listeners.get(name) ?? [])]) {
      try {
        (fn as Listener<K>)(payload as TourEventMap[K]);
      } catch {
        // a broken tour listener must never break the app action that emitted
      }
    }
  },
  on<K extends TourEventName>(name: K, fn: Listener<K>): () => void {
    let set = listeners.get(name);
    if (!set) listeners.set(name, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  },
};
