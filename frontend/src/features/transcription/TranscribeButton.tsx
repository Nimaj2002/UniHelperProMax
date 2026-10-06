import { Article } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RecordingExtensionProps } from "@/features/recordings/extensions";
import { useActiveTranscription } from "./api";
import { TranscribeDialog } from "./TranscribeDialog";

/** "Transcribe" on each finished recording; disabled with a reason while unavailable (FR-001, FR-012). */
export function TranscribeButton({ recording, sessionKey }: RecordingExtensionProps) {
  const active = useActiveTranscription();
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  if (recording.status === "recording") return null; // available once stopped
  const running = active.data;
  const reason = recording.missing
    ? "The audio file is missing."
    : running && running.recordingId !== recording.id
      ? "A transcription is already running."
      : null; // this recording's own running job is explained by its status row
  const disabled = Boolean(reason || running);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        aria-describedby={reason ? reasonId : undefined}
        aria-label={`Transcribe ${recording.name}`}
        onClick={() => setOpen(true)}
      >
        <Article size={16} aria-hidden /> Transcribe
      </Button>
      {reason && (
        <span id={reasonId} className="text-xs text-muted-foreground">
          {reason}
        </span>
      )}
      {open && <TranscribeDialog recording={recording} sessionKey={sessionKey} onClose={() => setOpen(false)} />}
    </div>
  );
}
