import { UploadSimple } from "@phosphor-icons/react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AUDIO_ACCEPT } from "./audioFiles";
import { importQueue } from "./importQueue";

/** "Upload audio" beside Record: always available, also while recording (006 FR-001, FR-002). */
export function UploadAudioButton({ sessionKey, compact = false }: { sessionKey: string; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label="Upload audio" onClick={() => input.current?.click()}>
              <UploadSimple size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload audio</TooltipContent>
        </Tooltip>
      ) : (
        <Button variant="outline" onClick={() => input.current?.click()}>
          <UploadSimple size={16} aria-hidden /> Upload audio
        </Button>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={AUDIO_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        data-testid="upload-audio-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = ""; // picking the same file again must fire change again
          if (files.length) importQueue().enqueue(sessionKey, files);
        }}
      />
    </>
  );
}
