/**
 * The calendar's "Show tasks" switch (FR-046, research R16): on by default (the home "Both" setting), remembered per
 * browser in `uh.calendar.showTasks`. A tiny external store so the header switch and the views
 * share one value.
 */
import { useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "@/lib/storage";

export const SHOW_TASKS_KEY = "uh.calendar.showTasks";

const listeners = new Set<() => void>();
let value: boolean | null = null;

function read(): boolean {
  value ??= readLocal<unknown>(SHOW_TASKS_KEY, true) !== false;
  return value;
}

export function setShowTasks(on: boolean) {
  value = on;
  writeLocal(SHOW_TASKS_KEY, on);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShowTasks(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => true);
  return [on, setShowTasks];
}
