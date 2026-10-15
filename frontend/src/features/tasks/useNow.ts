import { useEffect, useState } from "react";

/**
 * The current time, re-rendering every `intervalMs` (default 60 s) so due chips and the rail's
 * overdue indicator change when a due time passes, without a reload (FR-074).
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
