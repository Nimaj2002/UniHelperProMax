import type { TranscriptionJob } from "./api";

/** "Uploading 42 %", "Transcribing part 2 of 3", "Adding to note" (FR-013). */
export function stageLabel(job: TranscriptionJob): string {
  const parts = job.partCount > 1 ? ` part ${job.partIndex + 1} of ${job.partCount}` : "";
  const pct = job.progress != null ? ` ${Math.round(job.progress * 100)} %` : "";
  switch (job.status) {
    case "queued":
      return "Queued";
    case "uploading":
      return `Uploading${parts}${pct}`;
    case "transcribing":
      return `Transcribing${parts}`;
    case "appending":
      return "Adding to note";
    default:
      return job.status;
  }
}

/** Throttled text for screen readers: stage changes and every 10 % (no per-second noise). */
export function announcement(job: TranscriptionJob): string {
  const tens = job.progress != null ? ` ${Math.floor(job.progress * 10) * 10} %` : "";
  const stage = job.status === "appending" ? "Adding to note" : job.status === "queued" ? "Queued" : job.status === "uploading" ? "Uploading" : "Transcribing";
  return `Transcription: ${stage}${tens}`;
}
