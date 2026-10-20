/**
 * 014 FR-030/FR-031/FR-036/FR-052 (contracts/ui-contract.md "Message box"): attachment chips
 * (with thumbnails, upload progress and "No longer available"), the auto-growing text area, then
 * Attach, the model button, the context list and Send/Stop in the same place. Enter sends (never
 * while composing text), Shift+Enter adds a line, Escape stops an answer. Pictures can be pasted
 * or dropped on the box. The text is the chat's draft (drafts.ts), so it survives view switches,
 * tabs and restarts.
 */
import { ArrowUp, FilePdf, Microphone, NotePencil, Square, X } from "@phosphor-icons/react";
import {
  forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode,
} from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { attachmentKey, chatFileUrl, type ContextItemRef } from "./api";
import { metaOf, removeAttachment, uploadAttachments, useAttachMeta, useAttachState } from "./attachments";
import { getDraft, useChatDraft } from "./drafts";

/** One line of the text area (text-sm, leading-5) and its vertical padding. */
export const LINE_PX = 20;
const PAD_PX = 16;
export const MAX_LINES = 8;
export const MAX_BOX_PX = MAX_LINES * LINE_PX + PAD_PX;
/** Browsers that size a text area to its content themselves: no measuring on each key, which
 *  would re-lay out a long conversation next to it (SC-007). */
const sizesItself = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

export interface MessageBoxHandle {
  focus: () => void;
}

interface Props {
  sessionKey: string;
  /** The chat this box writes to; null (or a `new:` id) for the new-chat box. */
  chatId: string | null;
  /** DOM id of the text area (focus after Expand, Dock, Stop and sending). */
  textareaId: string;
  generating: boolean;
  /** Send; resolves true when the message was accepted (the draft is then cleared). */
  onSend: (text: string, attachments: ContextItemRef[]) => Promise<boolean>;
  onStop: () => void;
  /** No model is configured: the box is disabled (FR-022). */
  disabled?: boolean;
  /** The model button (ModelPicker). */
  model?: ReactNode;
  /** The Attach menu (AttachMenu). */
  attach?: ReactNode;
  /** The context list button (ContextList), after the model. */
  context?: ReactNode;
  /** A chip's title when the attachment store doesn't know it (default: its kind). */
  attachmentTitle?: (a: ContextItemRef) => string;
  /** A line above the box (a send error). */
  notice?: ReactNode;
}

const KIND_ICON = { note: NotePencil, document: FilePdf, recording: Microphone } as const;

function ChipIcon({ a, mime }: { a: ContextItemRef; mime?: string | null }) {
  if (a.kind === "upload" && mime?.startsWith("image/"))
    return <img src={chatFileUrl(a.ref)} alt="" className="size-5 shrink-0 rounded-sm object-cover" data-testid="attachment-thumbnail" />;
  const Icon = a.kind === "upload" ? (mime?.startsWith("audio/") ? Microphone : FilePdf) : KIND_ICON[a.kind];
  return <Icon size={12} aria-hidden className="shrink-0" />;
}

export const MessageBox = forwardRef<MessageBoxHandle, Props>(function MessageBox(
  { sessionKey, chatId, textareaId, generating, onSend, onStop, disabled, model, attach, context, attachmentTitle, notice },
  ref,
) {
  const draft = useChatDraft(sessionKey, chatId);
  const { uploads, message } = useAttachState(sessionKey, chatId);
  useAttachMeta();
  const area = useRef<HTMLTextAreaElement>(null);
  const [native] = useState(sizesItself);
  const [sending, setSending] = useState(false);
  const [dropping, setDropping] = useState(false);
  const focus = () => area.current?.focus();
  useImperativeHandle(ref, () => ({ focus }));

  // grow with the text up to eight lines, then scroll (FR-030)
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || native) return;
    el.style.height = "auto";
    const h = Math.min(el.scrollHeight || LINE_PX + PAD_PX, MAX_BOX_PX);
    el.style.height = `${Math.max(h, LINE_PX + PAD_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_BOX_PX ? "auto" : "hidden";
  }, [draft.text]);

  const empty = !draft.text.trim() && !draft.attachments.length;
  const canSend = !disabled && !empty && !generating && !sending && !uploads.length;

  const send = async () => {
    if (!canSend) return;
    const text = draft.text;
    const attachments = draft.attachments;
    setSending(true);
    try {
      if (await onSend(text, attachments)) {
        // keep anything typed while the request was on its way
        if (getDraft(sessionKey, chatId).text === text) draft.clear();
      }
    } finally {
      setSending(false);
      requestAnimationFrame(focus);
    }
  };

  const stop = () => {
    onStop();
    requestAnimationFrame(focus);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && generating) {
      e.preventDefault();
      e.stopPropagation();
      stop();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    // never send while an input method composes text (Chinese, Japanese, …)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    void send();
  };

  // FR-052: pictures pasted from the clipboard or dropped on the box are uploaded and attached
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const files = [...e.clipboardData.items].filter((i) => i.kind === "file" && i.type.startsWith("image/")).flatMap((i) => i.getAsFile() ?? []);
    if (!files.length) return;
    e.preventDefault();
    uploadAttachments(sessionKey, chatId, files);
  };
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDropping(false);
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length) uploadAttachments(sessionKey, chatId, files);
    focus();
  };

  const chips = draft.attachments.length > 0 || uploads.length > 0;

  return (
    <div className="shrink-0 p-2">
      {notice}
      {message && (
        <p role="alert" className="mb-1.5 px-1 text-xs text-danger">
          {message}
        </p>
      )}
      <div
        onDragOver={onDragOver}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-lg border border-strong-border bg-surface-elevated focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
          disabled && "opacity-70",
          dropping && "border-ring ring-2 ring-ring/40",
        )}
      >
        {chips && (
          <ul aria-label="Attachments" className="flex flex-wrap gap-1 px-2 pt-2">
            {draft.attachments.map((a) => {
              const meta = metaOf(a);
              const title = meta?.title ?? attachmentTitle?.(a) ?? a.kind;
              const missing = meta?.available === false;
              return (
                <li key={attachmentKey(a)}>
                  <button
                    type="button"
                    aria-label={`Remove ${title}`}
                    title={missing ? `${title} — No longer available` : title}
                    onClick={() => {
                      removeAttachment(sessionKey, chatId, a);
                      focus();
                    }}
                    className="inline-flex max-w-56 items-center gap-1 rounded-md border border-divider bg-surface-sunken px-2 py-0.5 text-xs hover:bg-surface-hover"
                  >
                    <ChipIcon a={a} mime={meta?.mime} />
                    <span className={cn("truncate", missing && "line-through")}>{title}</span>
                    {a.pdfMode === "text" && <span className="shrink-0 text-muted-foreground">text</span>}
                    {missing && <span className="shrink-0 text-danger">No longer available</span>}
                    <X size={12} aria-hidden className="shrink-0" />
                  </button>
                </li>
              );
            })}
            {uploads.map((u) => {
              const pct = u.total ? Math.round((u.loaded / u.total) * 100) : 0;
              return (
                <li key={u.id}>
                  <span className="inline-flex max-w-56 items-center gap-1.5 rounded-md border border-divider bg-surface-sunken py-0.5 pr-1 pl-2 text-xs">
                    <span className="truncate">{u.name}</span>
                    <span
                      role="progressbar"
                      aria-label={`Uploading ${u.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-surface-hover"
                    >
                      <span className="block h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
                    </span>
                    <button
                      type="button"
                      aria-label={`Cancel upload of ${u.name}`}
                      onClick={() => {
                        u.abort();
                        focus();
                      }}
                      className="inline-flex size-4 items-center justify-center rounded hover:bg-surface-hover"
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <textarea
          ref={area}
          id={textareaId}
          aria-label="Message"
          rows={1}
          placeholder="Ask about this session…"
          disabled={disabled}
          value={draft.text}
          onChange={(e) => draft.setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-keyshortcuts="Alt+K Enter Shift+Enter Escape"
          style={native ? { maxHeight: MAX_BOX_PX, minHeight: LINE_PX + PAD_PX, fieldSizing: "content", overflowY: "auto" } : { maxHeight: MAX_BOX_PX }}
          className="block w-full resize-none bg-transparent px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <div className="flex min-w-0 items-center gap-1 px-1.5 pb-1.5">
          {attach}
          {model}
          <div className="flex-1" />
          {context}
          {generating ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Stop"
                  aria-keyshortcuts="Escape"
                  onClick={stop}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background hover:opacity-90"
                >
                  <Square size={12} weight="fill" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                Stop <kbd className="ml-1 font-mono">Esc</kbd>
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              aria-label="Send"
              aria-keyshortcuts="Enter"
              aria-disabled={!canSend || undefined}
              onClick={() => void send()}
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
                canSend ? "bg-primary text-primary-foreground hover:bg-primary/90" : "cursor-not-allowed bg-surface-sunken text-muted-foreground",
              )}
            >
              <ArrowUp size={14} weight="bold" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
