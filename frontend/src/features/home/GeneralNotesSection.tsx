/**
 * General notes (018): the scratchpad section under Tasks in the home page's right column. Its
 * notes open in a pop-up, never in a session workspace, so it can't be mistaken for where
 * lecture notes go.
 */
import { NotePencil, Plus } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { toast } from "sonner";
import { CollapsibleSection } from "@/app/shell/panelSection";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isApiError } from "@/lib/api";
import { GeneralNoteDialog } from "./GeneralNoteDialog";
import { autoName, createGeneralNote, generalNotesKey, useGeneralNotes } from "./generalNotesApi";
import { COLUMN_SECTION_ID } from "./tasksColumn";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  sectionRef?: Ref<HTMLElement>;
  style?: CSSProperties;
  className?: string;
  /** The resize handle on the boundary with Tasks. */
  handle?: ReactNode;
}

export function GeneralNotesSection({ collapsed, onToggle, sectionRef, style, className, handle }: Props) {
  const qc = useQueryClient();
  const notes = useGeneralNotes();
  const [open, setOpen] = useState<{ id: string; createdHere: boolean } | null>(null);
  // not `disabled` while creating: a disabled button drops focus, which must return to it (FR-018)
  const creating = useRef(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const show = (id: string, createdHere: boolean) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen({ id, createdHere });
  };
  // back to what opened the pop-up; a deleted note's row is gone, so then to "New" (FR-018).
  // Retried for a few frames: until the dialog has unmounted the rest of the page can't take focus.
  const hide = () => {
    setOpen(null);
    const refocus = (frames: number) =>
      requestAnimationFrame(() => {
        const el = opener.current?.isConnected ? opener.current : newButton.current;
        el?.focus();
        if (el && document.activeElement !== el && frames > 0) refocus(frames - 1);
      });
    refocus(10);
  };

  const create = async () => {
    if (creating.current) return;
    creating.current = true;
    const base = autoName();
    try {
      // two notes in the same minute: the second takes " (2)"
      const note = await createGeneralNote(base).catch((err) => {
        if (isApiError(err, "name_taken")) return createGeneralNote(`${base} (2)`);
        throw err;
      });
      void qc.invalidateQueries({ queryKey: generalNotesKey });
      show(note.id, true);
    } catch {
      toast.error("Couldn't create the note. Try again.");
    } finally {
      creating.current = false;
    }
  };

  const list = notes.data ?? [];
  return (
    <CollapsibleSection
      id={COLUMN_SECTION_ID.notes}
      title="General notes"
      actionNames
      collapsed={collapsed}
      onToggle={onToggle}
      sectionRef={sectionRef}
      style={style}
      className={className}
      handle={handle}
      headerClassName="h-10 shrink-0 pl-1"
      bodyClassName="overflow-y-auto border-t border-divider px-3 py-2"
      actions={
        <Tooltip>
          <TooltipTrigger asChild>
            <Button ref={newButton} variant="ghost" size="icon" className="size-8" aria-label="New general note" onClick={() => void create()}>
              <Plus size={16} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New general note</TooltipContent>
        </Tooltip>
      }
    >
      <p className="pb-1.5 text-xs text-text-muted">
        Scratchpad for quick thoughts that don't belong to a class. Lecture notes go in a class session.
      </p>
      {notes.isError ? (
        <p role="alert" className="text-xs text-danger">Couldn't load general notes.</p>
      ) : notes.isSuccess && list.length === 0 ? (
        <p className="py-2 text-xs text-text-muted">
          No general notes yet. Use them for reminders, ideas and to-dos — not for lecture notes.
        </p>
      ) : (
        <ul className="grid gap-0.5" aria-label="General notes">
          {list.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => show(n.id, false)}
              >
                <NotePencil size={12} aria-hidden className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-text-primary">{n.name}</span>
                <time dateTime={n.updatedAt} className="shrink-0 text-text-muted">
                  {formatDistanceToNow(parseISO(n.updatedAt), { addSuffix: true })}
                </time>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <GeneralNoteDialog key={open.id} noteId={open.id} createdHere={open.createdHere} onClose={hide} />}
    </CollapsibleSection>
  );
}
