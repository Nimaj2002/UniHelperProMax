/** 023: tiny store so the rail button and Settings can start the tour the host renders. */
import { useSyncExternalStore } from "react";
import type { ChapterId } from "./steps";

export interface TourRequest {
  chapter: ChapterId;
  /** Offer "Continue from <chapter>?" first (an interrupted tour, FR-021). */
  resume?: boolean;
  /** Set by auto-start on first run; a welcome step then offers "Maybe later". */
  firstRun?: boolean;
  /** Bumped on every request so asking again restarts a running tour. */
  n?: number;
}

let current: TourRequest | null = null;
let seq = 0;
const subs = new Set<() => void>();
const set = (r: TourRequest | null) => {
  current = r && { ...r, n: ++seq };
  subs.forEach((f) => f());
};

export const startTour = (chapter: ChapterId = "welcome") => set({ chapter });
export const requestTour = (r: TourRequest) => set(r);
export const closeTour = () => set(null);
export function useTourRequest() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => current,
    () => current,
  );
}
