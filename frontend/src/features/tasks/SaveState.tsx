import { CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import type { SaveStatus } from "@/features/sessions/autosave";
import { cn } from "@/lib/utils";

export const SAVE_TEXT = { saving: "Saving…", saved: "Saved", failed: "Couldn't save" } as const;

export const isFailed = (status: SaveStatus) => status === "error" || status === "conflict";

/**
 * A save state in the style of the notes' `StatusLabel` (FR-025, FR-030): "Saving…", "Saved" or
 * "Couldn't save — Retry". Polite live region; never color alone (icon + words).
 */
export function SaveState({
  status,
  onRetry,
  className,
  testId,
}: {
  status: SaveStatus;
  onRetry: () => void;
  className?: string;
  testId?: string;
}) {
  const failed = isFailed(status);
  const busy = status === "dirty" || status === "saving";
  const Icon = failed ? WarningCircle : busy ? CircleNotch : CheckCircle;
  return (
    <p
      aria-live="polite"
      data-testid={testId}
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs", failed ? "text-danger" : "text-text-muted", className)}
    >
      <Icon
        size={12}
        aria-hidden
        className={busy ? "animate-spin [animation-duration:1.5s] motion-reduce:animate-none" : undefined}
      />
      {failed ? (
        <>
          {SAVE_TEXT.failed} —{" "}
          <button type="button" className="rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onRetry}>
            Retry
          </button>
        </>
      ) : busy ? (
        SAVE_TEXT.saving
      ) : (
        SAVE_TEXT.saved
      )}
    </p>
  );
}
