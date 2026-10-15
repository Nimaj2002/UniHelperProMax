/**
 * Scroll positions of the home page (FR-045, FR-089, research R12): the calendar's time grid, the
 * board (horizontal), each board column and the list. Kept in module memory — like
 * `calendar/state.ts` — so leaving the home page (e.g. "Open note") and coming back with Back
 * shows the panels where they were. Saved on every scroll (the elements are already detached
 * when an unmount cleanup runs) and restored when the element mounts again.
 */
import { useCallback, useRef } from "react";

export type ScrollAxis = "top" | "left";

const memory = new Map<string, number>();

export const scrollKeys = {
  calendarGrid: "calendar-grid",
  board: "board",
  column: (id: string) => `column:${id}`,
  list: "list",
};

export function rememberScroll(key: string, value: number) {
  memory.set(key, value);
}

export function recalledScroll(key: string): number | undefined {
  return memory.get(key);
}

/** Apply a remembered position to `el`; true when there was one. */
export function restoreScroll(key: string, el: HTMLElement, axis: ScrollAxis = "top"): boolean {
  const value = memory.get(key);
  if (value === undefined) return false;
  if (axis === "top") el.scrollTop = value;
  else el.scrollLeft = value;
  return true;
}

/** For tests. */
export function clearScrollMemory() {
  memory.clear();
}

/**
 * A callback ref that restores `key`'s position when the element mounts and remembers it while
 * the user scrolls.
 */
export function useScrollMemory<T extends HTMLElement>(key: string, axis: ScrollAxis = "top") {
  const detach = useRef<(() => void) | null>(null);
  return useCallback(
    (el: T | null) => {
      detach.current?.();
      detach.current = null;
      if (!el) return;
      restoreScroll(key, el, axis);
      const onScroll = () => rememberScroll(key, axis === "top" ? el.scrollTop : el.scrollLeft);
      el.addEventListener("scroll", onScroll, { passive: true });
      detach.current = () => el.removeEventListener("scroll", onScroll);
    },
    [key, axis],
  );
}
