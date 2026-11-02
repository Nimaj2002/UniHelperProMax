/**
 * The Time item of the closed right panel's rail (020 FR-003): while a timer runs it shows the
 * minutes (or hours) and a play/pause glyph, plus text for screen readers — never colour alone.
 */
import { clockOffset, useTimer } from "./api";
import { elapsedMs, remainingMs } from "./clock";
import { useTick } from "./useTick";

export function RailTimeBadge() {
  const timer = useTimer().data ?? null;
  const now = useTick(!!timer);
  if (!timer) return null;
  const ms = timer.style === "track" ? elapsedMs(timer, now, clockOffset()) : remainingMs(timer, now, clockOffset());
  const min = Math.floor(ms / 60_000);
  const text = min >= 60 ? `${Math.floor(min / 60)}h` : `${min}m`;
  const paused = timer.state !== "running";
  return (
    <span className="flex flex-col items-center text-[10px] leading-tight tabular-nums" data-testid="rail-timer">
      <span aria-hidden>{paused ? "❚❚" : "▶"}</span>
      <span aria-hidden>{text}</span>
      <span className="sr-only">{paused ? "Timer paused" : "Timer running"}</span>
    </span>
  );
}
