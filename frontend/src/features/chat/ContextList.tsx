/**
 * 014 US9 FR-055/FR-056 (contracts/ui-contract.md "Context list"): what the next message will
 * carry — the chat's context plus the draft's attachments — with each item's size estimate, the
 * total against the model's limit when known, Remove buttons, and the chosen style's per-file and
 * per-message limits. `usePreflight` asks the server (`POST /chats/preflight`) 400 ms after the
 * model, the attachments or the context change. Over the limit, `OverLimitAlert` offers "Remove
 * items" and "Start a new chat".
 */
import { Stack, WarningCircle, X } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { attachmentKey, preflight, type ContextItemRef, type ModelRef, type Preflight, type PreflightItem } from "./api";
import { rememberMeta } from "./attachments";
import { getDraft } from "./drafts";

export const PREFLIGHT_DEBOUNCE_MS = 400;
export const preflightKey = ["chat-preflight"] as const;

interface PreflightInput {
  sessionKey: string;
  /** The chat whose context and history count (null: a new chat). */
  chatId: string | null;
  model: ModelRef | undefined;
  attachments: ContextItemRef[];
  /** Changes when the chat's context changes (its items' keys). */
  contextSig: string;
}

/** The preflight of the next message, 400 ms after its inputs settle. */
export function usePreflight({ sessionKey, chatId, model, attachments, contextSig }: PreflightInput) {
  // by value: the draft's array changes identity on every keystroke
  const sig = JSON.stringify({
    sessionKey,
    chatId,
    model: model ? { endpointId: model.endpointId, modelId: model.modelId } : null,
    attachments: attachments.map(({ kind, ref, pdfMode }) => (pdfMode ? { kind, ref, pdfMode } : { kind, ref })),
    contextSig,
  });
  const [settledSig, setSettledSig] = useState(sig);
  useEffect(() => {
    const t = setTimeout(() => setSettledSig(sig), PREFLIGHT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [sig]);
  const settled = useMemo(() => JSON.parse(settledSig) as Omit<PreflightInput, "model"> & { model: ModelRef | null }, [settledSig]);
  const query = useQuery({
    queryKey: [...preflightKey, settled.sessionKey, settled.chatId, settled.model, settled.attachments, settled.contextSig],
    queryFn: async ({ signal }) => {
      const res = await preflight(
        {
          sessionKey: settled.sessionKey,
          chatId: settled.chatId,
          model: settled.model!,
          text: getDraft(settled.sessionKey, settled.chatId).text,
          attachments: settled.attachments,
        },
        signal,
      );
      rememberMeta(res.items);
      return res;
    },
    enabled: !!settled.model && !!settled.sessionKey,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return query;
}

const MB = 1024 * 1024;
export function formatBytes(n: number): string {
  if (n >= MB) {
    const v = n / MB;
    return `${Number.isInteger(v) ? v : v.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function contextLabel(p: Pick<Preflight, "items" | "estimatedTokens" | "contextLimit">): string {
  const n = p.items.length;
  const tokens = `~${p.estimatedTokens.toLocaleString("en-US")} tokens`;
  const of = p.contextLimit ? ` of ${p.contextLimit.toLocaleString("en-US")}` : "";
  return `Context (${n} ${n === 1 ? "item" : "items"}, ${tokens}${of})`;
}

/** FR-055: the chosen style's limits, in one or two sentences. */
export function limitsText(limits: Preflight["limits"]): string {
  const per = limits.perFileBytes;
  const kinds = [per.image && `pictures ${formatBytes(per.image)}`, per.pdf && `PDFs ${formatBytes(per.pdf)}`, per.audio && `audio ${formatBytes(per.audio)}`].filter(Boolean);
  const parts = [
    kinds.length ? `Per file: ${kinds.join(", ")}.` : "",
    `Per message: ${formatBytes(limits.perMessageBytes)} of attachments, at most ${limits.maxAttachments} attachments.`,
    limits.maxPdfPages ? `PDFs up to ${limits.maxPdfPages} pages.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

interface Props {
  result: Preflight | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (item: PreflightItem) => void;
  /** Give focus back to the message box when the list closes. */
  onClosed?: () => void;
}

export function ContextList({ result, open, onOpenChange, onRemove, onClosed }: Props) {
  if (!result) return null;
  const label = contextLabel(result);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs tabular-nums hover:bg-surface-hover hover:text-foreground",
            result.overLimit ? "text-danger" : "text-muted-foreground",
          )}
        >
          <Stack size={14} aria-hidden />
          <span aria-hidden>
            {result.items.length > 0 && `${result.items.length} · `}~{compact(result.estimatedTokens)}
            {result.contextLimit ? `/${compact(result.contextLimit)}` : ""}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-80 p-2"
        aria-label="Context"
        onCloseAutoFocus={(e) => {
          if (onClosed) {
            e.preventDefault();
            onClosed();
          }
        }}
      >
        <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
          ~{result.estimatedTokens.toLocaleString("en-US")} tokens
          {result.contextLimit ? ` of ${result.contextLimit.toLocaleString("en-US")}` : " (this model's limit isn't known)"}
        </p>
        {result.items.length ? (
          <ul aria-label="Context items" className="grid max-h-60 gap-0.5 overflow-y-auto">
            {result.items.map((item) => (
              <li key={attachmentKey(item)} className="flex min-w-0 items-start gap-2 rounded px-1 py-1 hover:bg-surface-hover">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    ~{item.estimatedTokens.toLocaleString("en-US")} tokens
                    {item.pdfMode === "text" && " · as text"}
                  </span>
                  {!item.available ? (
                    <span className="text-xs text-danger">No longer available</span>
                  ) : (
                    !item.accepted && item.reason && <span className="text-xs text-danger">{item.reason}</span>
                  )}
                </div>
                <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Remove ${item.title}`} onClick={() => onRemove(item)}>
                  <X size={14} aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 py-2 text-sm text-muted-foreground">Nothing attached. The conversation so far is the context.</p>
        )}
        <p className="mt-2 border-t border-divider px-1 pt-2 text-xs text-muted-foreground" data-testid="context-limits">
          {limitsText(result.limits)}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** FR-056: the conversation would go over the model's limit. */
export function OverLimitAlert({ onRemoveItems, onNewChat }: { onRemoveItems: () => void; onNewChat: () => void }) {
  return (
    <div role="alert" className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-danger/40 bg-surface-sunken px-2 py-1.5 text-xs">
      <WarningCircle size={14} aria-hidden className="shrink-0 text-danger" />
      <span className="min-w-0 flex-1 basis-40 text-foreground">This conversation is larger than the model can take</span>
      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onRemoveItems}>
        Remove items
      </Button>
      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onNewChat}>
        Start a new chat
      </Button>
    </div>
  );
}
