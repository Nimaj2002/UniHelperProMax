/**
 * Opening Time mode in the home page's right panel from anywhere (020 FR-031, FR-047): the floating
 * pill and the calendar's time blocks ask for it; `HomePage` switches the panel to Time and opens
 * it. Outside the home page, navigate to `/?time` instead.
 */
import type { Entry } from "./api";

let pending = false;
const listeners = new Set<() => void>();

export function requestTimePanel() {
  pending = true;
  listeners.forEach((l) => l());
}

/** Read and clear the pending request. */
export function takeTimeRequest(): boolean {
  const p = pending;
  pending = false;
  return p;
}

export function onTimeRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** An entry the Time panel should open for editing (calendar blocks); kept across navigation. */
let editRequest: Entry | null = null;
const editListeners = new Set<() => void>();
export function requestEntryEdit(entry: Entry) {
  editRequest = entry;
  editListeners.forEach((l) => l());
}
export function takeEntryEdit(): Entry | null {
  const e = editRequest;
  editRequest = null;
  return e;
}
export function onEntryEdit(listener: () => void): () => void {
  editListeners.add(listener);
  return () => editListeners.delete(listener);
}

export const TIME_HREF = "/?time";
export const TIMER_CARD_ID = "time-timer-card";
