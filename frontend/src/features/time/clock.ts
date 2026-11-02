/**
 * Time is computed from the server's stored times, never counted (020 research R2). `offset` is
 * server time minus local time, so a wrong device clock doesn't change what's shown.
 */
export interface TimerTimes {
  startedAt: string;
  pausedAt?: string | null;
  pausedMs: number;
  plannedEndAt?: string | null;
}

/** Server-minus-local offset from a response's `serverNow`, taking the request's midpoint. */
export function serverOffset(serverNow: string, sentAt: number, receivedAt: number): number {
  return Date.parse(serverNow) - (sentAt + receivedAt) / 2;
}

/** Counted time so far: frozen at the pause while paused. */
export function elapsedMs(t: TimerTimes, now: number, offset = 0): number {
  const at = t.pausedAt ? Date.parse(t.pausedAt) : now + offset;
  return Math.max(0, at - Date.parse(t.startedAt) - t.pausedMs);
}

/** Time left until the planned end (Pomodoro and Focus); frozen while paused. */
export function remainingMs(t: TimerTimes, now: number, offset = 0): number {
  if (!t.plannedEndAt) return 0;
  const at = t.pausedAt ? Date.parse(t.pausedAt) : now + offset;
  return Math.max(0, Date.parse(t.plannedEndAt) - at);
}

/** `0:25:03`, `1:05:00`, `26:14:03` — hours keep counting past a day. */
export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** Countdown style for Pomodoro and Focus: `24:59`, `1:29:59` over an hour. */
export function formatCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/** `1 h 20 min`, `45 min`, `30 s` for totals. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/** Words for screen readers: "1 hour 5 minutes". */
export function spokenDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  const parts = [h && `${h} hour${h === 1 ? "" : "s"}`, `${m % 60} minute${m % 60 === 1 ? "" : "s"}`];
  return parts.filter(Boolean).join(" ");
}
