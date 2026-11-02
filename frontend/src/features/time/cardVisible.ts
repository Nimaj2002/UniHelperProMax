/**
 * Whether the running timer's own card is on screen (020 FR-032): the floating pill hides while it
 * is, so the same timer is never shown twice.
 */
import { useEffect, useSyncExternalStore } from "react";

let visible = false;
const listeners = new Set<() => void>();

function set(v: boolean) {
  if (v === visible) return;
  visible = v;
  listeners.forEach((l) => l());
}

export function useTimerCardVisible(): boolean {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => visible, () => false);
}

/** Watch the timer card: at least half of it in view counts as visible. */
export function useWatchTimerCard(el: HTMLElement | null) {
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => set(!!e && e.isIntersecting && e.intersectionRatio >= 0.5 && !el.closest("[hidden],[inert]")), {
      threshold: [0, 0.5, 1],
    });
    io.observe(el);
    return () => {
      io.disconnect();
      set(false);
    };
  }, [el]);
}
