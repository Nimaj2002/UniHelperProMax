/**
 * The calendar's "Show time" switch (020 FR-044): on by default, remembered per browser in
 * `uh.calendar.showTime`. Shared by the header switch and the views.
 */
import { useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "@/lib/storage";

export const SHOW_TIME_KEY = "uh.calendar.showTime";

const listeners = new Set<() => void>();
let value: boolean | null = null;

function read(): boolean {
  value ??= readLocal<unknown>(SHOW_TIME_KEY, true) !== false;
  return value;
}

export function setShowTime(on: boolean) {
  value = on;
  writeLocal(SHOW_TIME_KEY, on);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShowTime(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => true);
  return [on, setShowTime];
}
