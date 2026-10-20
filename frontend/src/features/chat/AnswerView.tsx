/**
 * 014 FR-033–FR-035, FR-039: one answer — Markdown, "<Endpoint> · <Model>" with a Local/Remote
 * badge, its status when not completed, Copy and Regenerate, "‹ n/m ›" between versions, and the
 * usage when known. A failed answer shows the error in plain language with Retry.
 */
import { ArrowsClockwise, Copy, NotePencil } from "@phosphor-icons/react";
import { memo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RunStatus } from "@/lib/api/stream";
import type { AnswerError, ChatUsage } from "./api";
import { AnswerMarkdown, copyText } from "./AnswerMarkdown";
import { ErrorNotice } from "./ErrorNotice";
import { VersionSwitch } from "./VersionSwitch";

export interface AnswerShown {
  text: string;
  status: RunStatus;
  endpointLabel: string;
  modelLabel: string;
  locality?: "local" | "remote" | null;
  usage?: ChatUsage | null;
  error?: AnswerError | null;
}

interface Props {
  answer: AnswerShown;
  /** The endpoint's address, for "Couldn't reach <host>." */
  host?: string;
  version?: { index: number; count: number; onSelect: (i: number) => void };
  /** Regenerate (and Retry); disabled while this chat generates. */
  onRegenerate?: () => void;
  /** FR-058: append this answer to a note (AddToNoteDialog). */
  onAddToNote?: () => void;
  busy?: boolean;
}

/** FR-061: "Tokens: in N · out M" (or the total alone) when the provider reported usage. */
export function usageLine(u: ChatUsage | null | undefined): string | null {
  if (!u) return null;
  const parts = [u.input != null && `in ${u.input.toLocaleString("en-US")}`, u.output != null && `out ${u.output.toLocaleString("en-US")}`].filter(Boolean);
  if (!parts.length && u.total != null) parts.push(`${u.total.toLocaleString("en-US")} total`);
  return parts.length ? `Tokens: ${parts.join(" · ")}` : null;
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const AnswerView = memo(function AnswerView({ answer, host, version, onRegenerate, onAddToNote, busy }: Props) {
  const waiting = (answer.status === "queued" || answer.status === "streaming") && !answer.text;
  const live = answer.status === "queued" || answer.status === "streaming";
  const usage = usageLine(answer.usage);
  return (
    <article aria-label="Assistant" aria-busy={live || undefined} className="flex min-w-0 flex-col gap-1">
      {waiting ? (
        <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground" data-testid="answer-progress">
          <span aria-hidden className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
          Thinking…
        </p>
      ) : (
        answer.text && <AnswerMarkdown text={answer.text} />
      )}
      {answer.status === "failed" && answer.error && (
        <ErrorNotice error={answer.error} host={host} local={answer.locality === "local"} onRetry={onRegenerate} retryDisabled={busy} />
      )}
      {(answer.status === "stopped" || answer.status === "interrupted") && (
        <p className="text-xs font-medium text-warning">{answer.status === "stopped" ? "Stopped" : "Interrupted"}</p>
      )}
      <footer className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {answer.endpointLabel} · {answer.modelLabel}
        </span>
        {answer.locality && (
          <span className="shrink-0 rounded-full border border-divider px-1.5 leading-4">{answer.locality === "local" ? "Local" : "Remote"}</span>
        )}
        {usage && <span className="shrink-0">{usage}</span>}
        <span className="flex-1" />
        {!live && (
          <span className="flex shrink-0 items-center gap-0.5">
            {version && version.count > 1 && <VersionSwitch label="Answer version" {...version} disabled={busy} />}
            {answer.text && (
              <IconAction label="Copy" onClick={() => void copyText(answer.text, "Answer copied")}>
                <Copy size={14} aria-hidden />
              </IconAction>
            )}
            {answer.text && onAddToNote && (
              <IconAction label="Add to note" onClick={onAddToNote}>
                <NotePencil size={14} aria-hidden />
              </IconAction>
            )}
            {onRegenerate && (
              <IconAction label="Regenerate" onClick={onRegenerate} disabled={busy}>
                <ArrowsClockwise size={14} aria-hidden />
              </IconAction>
            )}
          </span>
        )}
      </footer>
    </article>
  );
});
