import { useEffect, useState } from "react";

/** Current time that re-renders at `nextChange` (e.g. the next session start) and every
 * minute — upcoming → past updates without reload (FR-027). */
export function useNow(changes?: number | string[]): number {
  const [now, setNow] = useState(() => Date.now());
  const key = Array.isArray(changes) ? changes.join("|") : String(changes ?? "");
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const minute = window.setInterval(tick, 60_000);
    const next = Array.isArray(changes) ? nextStart(changes, Date.now()) : changes;
    let at: number | undefined;
    if (next && next > Date.now()) {
      at = window.setTimeout(tick, Math.min(next - Date.now() + 50, 2 ** 31 - 1));
    }
    return () => {
      window.clearInterval(minute);
      if (at) window.clearTimeout(at);
    };
    // `key` captures the content of `changes`; `now` re-arms after each tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, now]);
  return now;
}

/** Status from the session start relative to now (the server's value is only initial). */
export function statusAt(startIso: string, now: number): "upcoming" | "past" {
  return Date.parse(startIso) > now ? "upcoming" : "past";
}

/** Earliest start in the future, for scheduling the next status flip. */
export function nextStart(starts: string[], now: number): number | undefined {
  let best: number | undefined;
  for (const s of starts) {
    const t = Date.parse(s);
    if (t > now && (best === undefined || t < best)) best = t;
  }
  return best;
}
