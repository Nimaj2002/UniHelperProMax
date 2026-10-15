/**
 * A card's quick notes (FR-028–FR-032): a pop-up inside the Tasks panel (portalled into
 * `#tasks-panel`), anchored to the card's quick-note button. Each note is a title and a plain
 * text, edited in place with its own save state; "New quick note" adds an empty note at the top
 * that is created on the first non-empty input (an untouched one just disappears on close);
 * Delete has Undo. Escape or the close button return focus to the quick-note button. Unmounting
 * (closing, or the panel closing) sends pending saves (`usePatchQuickNote`).
 */
import { Plus, Trash, X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateQuickNote,
  useDeleteQuickNote,
  usePatchQuickNote,
  useQuickNotes,
  type QuickNote,
} from "./api";
import { SaveState } from "./SaveState";

const TITLE_MAX = 200;
const BODY_MAX = 20_000;

/** The quick-note button of a task in the board or list (focus goes back to it). */
export const quickNotesButton = (taskId: string) =>
  document
    .getElementById("tasks-panel")
    ?.querySelector<HTMLElement>(`[data-quick-notes-for="${CSS.escape(taskId)}"]:not([inert] *)`) ?? null;

interface Props {
  taskId: string;
  taskTitle: string;
  /** The button that opened the pop-up (positioning and focus return). */
  anchor: HTMLElement | null;
  container: HTMLElement | null;
  onClose: () => void;
}

interface Draft {
  key: string;
  /** Set once the server created it. */
  noteId: string | null;
}

let seq = 0;

export function QuickNotesPopover({ taskId, taskTitle, anchor, container, onClose }: Props) {
  const notes = useQuickNotes(taskId);
  const titleId = useId();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const anchorRef = useRef(anchor);
  const claimed = new Set(drafts.map((d) => d.noteId).filter(Boolean));
  const list = (notes.data ?? []).filter((n) => !claimed.has(n.id));
  const byId = new Map((notes.data ?? []).map((n) => [n.id, n]));

  const returnFocus = () => {
    const el = anchorRef.current?.isConnected ? anchorRef.current : quickNotesButton(taskId);
    el?.focus();
  };

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor virtualRef={{ current: anchor ?? document.body }} />
      <PopoverContent
        container={container}
        align="end"
        side="bottom"
        collisionPadding={8}
        role="dialog"
        aria-labelledby={titleId}
        className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 p-3"
        // "Undo" in a toast must not close the pop-up it restores into
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest?.("[data-sonner-toaster]")) e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus();
        }}
        data-testid="quick-notes"
      >
        <div className="flex min-w-0 items-center gap-2">
          <h3 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">
            Quick notes <span className="sr-only">for </span>
            <span className="font-normal text-text-muted">· {taskTitle}</span>
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Close quick notes"
            onClick={onClose}
          >
            <X size={14} aria-hidden />
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 self-start"
          onClick={() => setDrafts((d) => [{ key: `draft-${++seq}`, noteId: null }, ...d])}
        >
          <Plus size={12} weight="bold" aria-hidden />
          New quick note
        </Button>
        <div className="-mx-1 flex min-h-0 flex-col gap-2 overflow-y-auto px-1 pb-1">
          {notes.isPending && <p className="text-xs text-text-muted">Loading…</p>}
          {notes.isError && (
            <p className="text-xs text-danger">
              Couldn't load the quick notes.{" "}
              <button type="button" className="underline" onClick={() => void notes.refetch()}>
                Retry
              </button>
            </p>
          )}
          {drafts.map((d) => (
            <NoteEditor
              key={d.key}
              taskId={taskId}
              note={d.noteId ? byId.get(d.noteId) : undefined}
              focusOnMount
              onCreated={(note) => setDrafts((all) => all.map((x) => (x.key === d.key ? { ...x, noteId: note.id } : x)))}
              onDeleted={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}
            />
          ))}
          {list.map((n) => (
            <NoteEditor key={n.id} taskId={taskId} note={n} />
          ))}
          {notes.isSuccess && list.length === 0 && drafts.length === 0 && (
            <p className="text-xs text-text-muted">No quick notes yet.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface EditorProps {
  taskId: string;
  /** Undefined for a new note not created yet. */
  note: QuickNote | undefined;
  focusOnMount?: boolean;
  onCreated?: (note: QuickNote) => void;
  onDeleted?: () => void;
}

function NoteEditor({ taskId, note, focusOnMount = false, onCreated, onDeleted }: EditorProps) {
  const handle = usePatchQuickNote(note);
  const sync = useRef(false);
  const create = useCreateQuickNote({
    onCreated: (saved) => {
      sync.current = true;
      onCreated?.(saved);
    },
  });
  const remove = useDeleteQuickNote();
  const initial = handle.values();
  const [title, setTitle] = useState(initial?.title ?? note?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? note?.body ?? "");
  const local = useRef({ title, body });
  const uid = useId();

  // a new note: created on the first non-empty input; what was typed meanwhile is saved after
  const created = useRef(!!note);
  const write = (fields: { title?: string; body?: string }) => {
    local.current = { ...local.current, ...fields };
    if (note) return handle.update(fields);
    if (created.current) return;
    const { title: t, body: b } = local.current;
    if (!t.trim() && !b.trim()) return;
    created.current = true;
    // claimed through the hook's onCreated (per-call callbacks are skipped after a re-render)
    create.mutateAsync({ taskId, title: t, body: b }).then(
      () => {},
      () => {
        created.current = false;
        toast.error("Couldn't save the quick note");
      },
    );
  };

  // after creation: send what changed while the request was in flight
  useEffect(() => {
    if (!note || !sync.current) return;
    sync.current = false;
    const diff: { title?: string; body?: string } = {};
    if (local.current.title !== note.title) diff.title = local.current.title;
    if (local.current.body !== note.body) diff.body = local.current.body;
    if (Object.keys(diff).length) handle.update(diff);
  });

  const status = note ? handle.status : create.isPending ? "saving" : create.isError ? "error" : "saved";
  const empty = !title.trim() && !body.trim();

  return (
    <div className="flex flex-col gap-1 rounded-md border border-divider bg-surface-elevated p-2" data-testid="quick-note">
      <div className="flex items-center gap-1">
        <Input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- a new note was asked for
          autoFocus={focusOnMount}
          value={title}
          maxLength={TITLE_MAX}
          placeholder="Title"
          aria-label="Quick note title"
          className="h-7 flex-1 border-transparent px-1 text-sm font-medium shadow-none"
          onChange={(e) => {
            setTitle(e.target.value);
            write({ title: e.target.value });
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-text-muted"
          aria-label={`Delete quick note ${title || "(untitled)"}`}
          disabled={remove.isPending || (!note && create.isPending)}
          onClick={() => {
            if (!note) return onDeleted?.();
            remove.mutateAsync(note).then(
              () => onDeleted?.(),
              () => toast.error("Couldn't delete the quick note"),
            );
          }}
        >
          <Trash size={14} aria-hidden />
        </Button>
      </div>
      <Textarea
        value={body}
        maxLength={BODY_MAX}
        placeholder="Write a quick note…"
        aria-label="Quick note text"
        aria-describedby={`${uid}-state`}
        rows={3}
        className="min-h-16 resize-y border-transparent px-1 text-sm shadow-none"
        onChange={(e) => {
          setBody(e.target.value);
          write({ body: e.target.value });
        }}
      />
      {!(empty && !note) && (
        <div id={`${uid}-state`} className="flex justify-end">
          <SaveState status={status} onRetry={() => void (note ? handle.retry() : write({}))} />
        </div>
      )}
    </div>
  );
}
