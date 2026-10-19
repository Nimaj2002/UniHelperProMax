import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(listener: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

/** The user's "reduce motion" setting (FR-040). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches);
}
