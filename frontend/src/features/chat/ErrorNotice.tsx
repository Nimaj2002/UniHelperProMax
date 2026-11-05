/** 014 FR-039: a failed answer in plain language, next to the message, with Retry. */
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import type { AnswerError } from "./api";

/** The sentence for an error category; `host` names the endpoint's address when known. */
export function errorSentence(error: AnswerError, host?: string, local?: boolean): string {
  switch (error.category) {
    case "network":
      return `Couldn't reach ${host ?? "the endpoint"}.${local ? " Check that the local server is running." : " Check your connection."}`;
    case "timeout":
      return `${host ?? "The endpoint"} took too long to answer.`;
    case "key_rejected":
      return "The provider rejected the key.";
    case "key_unreadable":
      return "The saved key can't be read on this computer. Enter it again in Settings → AI.";
    case "rate_limited":
      return error.retryAfterSeconds ? `Rate limited — try again in ${Math.ceil(error.retryAfterSeconds)} s.` : "Rate limited — try again in a moment.";
    case "model_not_found":
      return "The provider doesn't know this model. Check its ID in Settings → AI, or choose another model.";
    case "too_large":
      return "The request is too large for this provider. Remove some attachments or start a new chat.";
    case "context_exceeded":
      return "This conversation is larger than the model can take. Start a new chat or choose a model with a larger context.";
    case "not_this_style":
      return "This endpoint doesn't answer in the style set for it. Check the style in Settings → AI.";
    case "proxy":
      return error.message || "The proxy failed.";
    case "provider":
    default:
      return error.message || "The provider returned an error.";
  }
}

interface Props {
  error: AnswerError;
  host?: string;
  local?: boolean;
  onRetry?: () => void;
  retryDisabled?: boolean;
}

export function ErrorNotice({ error, host, local, onRetry, retryDisabled }: Props) {
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5 rounded-md border border-danger/40 bg-surface-sunken px-3 py-2 text-sm">
      <WarningCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 basis-48 text-foreground">
        {errorSentence(error, host, local)}
        {(error.category === "key_rejected" || error.category === "key_unreadable") && (
          <>
            {" "}
            <Link to="/settings/ai" className="font-medium text-primary underline underline-offset-2">
              Open AI settings
            </Link>
          </>
        )}
        {error.category === "proxy" && (
          <>
            {" "}
            <Link to="/settings/proxy" className="font-medium text-primary underline underline-offset-2">
              Open proxy settings
            </Link>
          </>
        )}
      </p>
      {onRetry && (
        <Button size="sm" variant="outline" className="h-7" onClick={onRetry} aria-disabled={retryDisabled || undefined} disabled={retryDisabled}>
          <ArrowClockwise size={14} aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}
