/** "1:02:03.250" / "2:03.250" / "3.5" ⇄ milliseconds, for the trim tool's exact time fields. */

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  const mmss = `${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
  return h ? `${h}:${mmss}` : mmss;
}

/** null when the text isn't a time. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d{0,3})?$/.test(p))) return null;
  const nums = parts.map(Number);
  const seconds = nums.pop() ?? 0;
  const [m = 0, h = 0] = nums.reverse();
  return Math.round(((h * 60 + m) * 60 + seconds) * 1000);
}

export const MIN_RANGE_MS = 100;

/** Same rules as the server: inside the audio, at least 100 ms, not the whole audio. */
export function rangeProblem(startMs: number, endMs: number, durationMs: number): string | null {
  if (startMs < 0 || endMs > durationMs || startMs >= endMs) return "The end must come after the start, inside the audio.";
  if (endMs - startMs < MIN_RANGE_MS) return "Keep at least 0.1 second.";
  if (startMs === 0 && endMs === durationMs) return "Nothing to trim yet: the whole audio is selected.";
  return null;
}
