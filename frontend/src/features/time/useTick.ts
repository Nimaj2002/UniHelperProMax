import { useSyncExternalStore } from "react";

/**
 * Now, re-rendering every second while `on` — one shared interval for every timer display. Only
 * the display ticks; time itself is always computed from stored times (020 research R2).
 */
let now = Date.now();
let id: number | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (id === undefined) {
    now = Date.now();
    id = window.setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.clearInterval(id);
      id = undefined;
    }
  };
}

const idle = () => () => {};
const snapshot = () => now;

export function useTick(on: boolean): number {
  return useSyncExternalStore(on ? subscribe : idle, snapshot, snapshot);
}
