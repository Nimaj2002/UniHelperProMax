/**
 * 014 FR-033/FR-059: a user message, as plain text with its whitespace kept, its attachments as
 * chips ("No longer available" when a referenced item is gone, FR-057), "‹ n/m ›" between its
 * versions, and — on the last message — "Edit and resend", an inline editor of its text and
 * attachments that sends a new version through edit.
 */
import { FilePdf, Microphone, NotePencil, PencilSimple, X } from "@phosphor-icons/react";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { attachmentKey, chatFileUrl, type ContextItem, type ContextItemRef } from "./api";
import { VersionSwitch } from "./VersionSwitch";

interface Props {
  text: string;
  /** The attachments sent with this version of the message. */
  attachments?: ContextItem[];
  /** Versions of this message: index and count, 0-based. */
  version?: { index: number; count: number; onSelect: (i: number) => void; disabled?: boolean };
  /** The last message: edit and resend (resolves true when the new version was accepted). */
  onEdit?: (text: string, attachments: ContextItemRef[]) => Promise<boolean>;
  /** An answer is generating: editing waits. */
  busy?: boolean;
}

function Chip({ item, onRemove }: { item: ContextItem; onRemove?: () => void }) {
  const image = item.kind === "upload" && item.mime?.startsWith("image/");
  const Icon = item.kind === "note" ? NotePencil : item.kind === "recording" || item.mime?.startsWith("audio/") ? Microphone : FilePdf;
  const body = (
    <>
      {image && item.available ? (
        <img src={chatFileUrl(item.ref)} alt="" className="size-5 shrink-0 rounded-sm object-cover" />
      ) : (
        <Icon size={12} aria-hidden className="shrink-0" />
      )}
      <span className={cn("truncate", !item.available && "line-through")}>{item.title}</span>
      {!item.available && <span className="shrink-0 text-danger">No longer available</span>}
    </>
  );
  const cls = "inline-flex max-w-56 items-center gap-1 rounded-md border border-divider bg-surface px-2 py-0.5 text-xs";
  if (!onRemove) return <span className={cls}>{body}</span>;
  return (
    <button type="button" aria-label={`Remove ${item.title}`} onClick={onRemove} className={cn(cls, "hover:bg-surface-hover")}>
      {body}
      <X size={12} aria-hidden className="shrink-0" />
    </button>
  );
}

export const UserMessage = memo(function UserMessage({ text, attachments = [], version, onEdit, busy }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const [items, setItems] = useState<ContextItem[]>(attachments);
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);

  const start = () => {
    setValue(text);
    setItems(attachments);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    requestAnimationFrame(() => editBtn.current?.focus());
  };
  const send = async () => {
    if (!onEdit || sending || busy || (!value.trim() && !items.length)) return;
    setSending(true);
    try {
      const ok = await onEdit(value, items.map(({ kind, ref, pdfMode }) => (pdfMode ? { kind, ref, pdfMode } : { kind, ref })));
      if (ok) setEditing(false);
    } finally {
      setSending(false);
    }
  };

  if (editing)
    return (
      <article aria-label="You" className="flex flex-col items-end gap-1">
        <div className="grid w-full max-w-[85%] gap-1.5 rounded-lg border border-ring bg-surface-elevated p-2">
          {items.length > 0 && (
            <ul aria-label="Attachments" className="flex flex-wrap gap-1">
              {items.map((a) => (
                <li key={attachmentKey(a)}>
                  <Chip item={a} onRemove={() => setItems((l) => l.filter((x) => attachmentKey(x) !== attachmentKey(a)))} />
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={area}
            aria-label="Edit message"
            value={value}
            rows={Math.min(8, Math.max(2, value.split("\n").length))}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              } else if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void send();
              }
            }}
            className="block w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7" onClick={cancel}>
              Cancel
            </Button>
            <Button size="sm" className="h-7" onClick={() => void send()} disabled={sending || busy || (!value.trim() && !items.length)}>
              Send
            </Button>
          </div>
        </div>
      </article>
    );

  return (
    <article aria-label="You" className="group/msg flex flex-col items-end gap-1">
      {attachments.length > 0 && (
        <ul aria-label="Attachments" className="flex max-w-[85%] flex-wrap justify-end gap-1">
          {attachments.map((a) => (
            <li key={attachmentKey(a)}>
              <Chip item={a} />
            </li>
          ))}
        </ul>
      )}
      <div className="max-w-[85%] rounded-lg bg-surface-sunken px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-foreground">{text}</div>
      {((version && version.count > 1) || onEdit) && (
        <div className="flex items-center gap-0.5">
          {onEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={editBtn}
                  type="button"
                  aria-label="Edit and resend"
                  disabled={busy}
                  onClick={start}
                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <PencilSimple size={14} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>Edit and resend</TooltipContent>
            </Tooltip>
          )}
          {version && version.count > 1 && <VersionSwitch label="Message version" {...version} />}
        </div>
      )}
    </article>
  );
});
