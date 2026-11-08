/**
 * 024: canned lecture content for the demo — the sample recording's identity and the transcript
 * the simulated transcriber "hears" from it (one string per transcribed part).
 */

/** Stable ids so the notes, recordings and transcription slices can refer to each other. */
export const LECTURE_NOTE_ID = "note-lecture";
export const LECTURE_RECORDING_ID = "rec-lecture";
export const LECTURE_RECORDING_NAME = "Lecture – Divide and Conquer";
export const LECTURE_DURATION_MS = 30_000; // length of assets/lecture-week3.wav

export const TRANSCRIPT: string[] = [
  "Okay, let's get started. Last week we looked at insertion sort and why it is quadratic in the worst case. Today is about a different way of designing algorithms: divide and conquer. The idea has three steps. You divide the problem into smaller instances of the same problem, you conquer each of them recursively, and then you combine the partial answers into an answer for the whole thing.",
  "Our main example is merge sort. We split the array in half, sort each half recursively, and then merge the two sorted halves. Merging walks through both halves once, so it costs linear time. That gives us the recurrence T of n equals two T of n over two plus theta of n.",
  "If you draw the recursion tree, every level does about n work in total, and there are log n levels until the pieces have size one. So merge sort runs in n log n. The master theorem gives the same answer directly: a is two, b is two, f of n is n, and that is case two. For Wednesday, please try the two recurrences on the last slide; we'll go through them at the start of the next lecture.",
];

/** `42s`, `12m 05s`, `1h 24m` (backend domain/transcript.py format_duration). */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/**
 * The section the real worker appends (domain/transcript.py `heading` + `section`).
 * `startedAt` is a wall-clock ISO time with offset, e.g. `2026-11-04T09:40:00+03:00`.
 */
export function transcriptSection(recordingName: string, startedAt: string, durationMs: number, parts = TRANSCRIPT): string {
  const when = `${startedAt.slice(0, 10)} ${startedAt.slice(11, 16)}`;
  const body = parts.map((t) => t.trim()).filter(Boolean).join("\n\n") || "(No speech detected)";
  return `## Transcript — ${recordingName} · ${when} · ${formatDuration(durationMs)}\n\n${body}\n`;
}
