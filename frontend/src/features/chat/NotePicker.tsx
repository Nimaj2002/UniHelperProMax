/**
 * 014 US6 FR-046 (research R13): the note picker of the Attach menu — a command dialog with
 * "Open note" (attach the note open in the workspace at once), "This session" (the session's
 * notes) and "Browse" (every note, searched on the server with a course filter, labelled with its
 * session). Notes of the last two groups are toggled and attached together, up to the
 * 10-attachment cap.
 */
import { Check, NotePencil } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNotes } from "@/features/sessions/api";
import { useCourseOptions } from "@/features/tasks/useCourseOptions";
import { cn } from "@/lib/utils";
import { searchNotes } from "./api";
import { CAP_MESSAGE } from "./attachments";

export interface PickedNote {
  id: string;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionKey: string;
  /** The note open in the workspace, if any. */
  openNoteId: string | null;
  /** How many more attachments this message can take. */
  room: number;
  /** Notes already attached (marked, not picked twice). */
  attached: Set<string>;
  onPick: (notes: PickedNote[]) => void;
  /** Focus back to the message box once the dialog has closed. */
  onClosed?: () => void;
}

const ALL = "__all";
const SEARCH_DEBOUNCE_MS = 200;

export function NotePicker({ open, onOpenChange, sessionKey, openNoteId, room, attached, onPick, onClosed }: Props) {
  const notes = useNotes(sessionKey);
  const courses = useCourseOptions();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [course, setCourse] = useState(ALL);
  const [picked, setPicked] = useState<PickedNote[]>([]);
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fresh picker each time it opens
    setPicked([]);
    setQ("");
    setCapped(false);
  }, [open]);

  const browse = useQuery({
    queryKey: ["note-search", query, course],
    queryFn: ({ signal }) => searchNotes(query, course === ALL ? null : course, signal),
    enabled: open,
    placeholderData: (prev) => prev,
  });

  const needle = q.trim().toLowerCase();
  const sessionNotes = useMemo(
    () => (notes.data ?? []).filter((n) => !needle || n.name.toLowerCase().includes(needle)),
    [notes.data, needle],
  );
  const openNote = openNoteId ? notes.data?.find((n) => n.id === openNoteId) : undefined;
  const others = (browse.data ?? []).filter((h) => h.sessionKey !== sessionKey);
  const isPicked = (id: string) => picked.some((p) => p.id === id);

  const toggle = (note: PickedNote) => {
    if (attached.has(note.id)) return;
    if (isPicked(note.id)) {
      setPicked((p) => p.filter((x) => x.id !== note.id));
      setCapped(false);
    } else if (picked.length >= room) setCapped(true);
    else setPicked((p) => [...p, note]);
  };

  const finish = (extra: PickedNote[] = []) => {
    const all = [...picked, ...extra.filter((e) => !isPicked(e.id) && !attached.has(e.id))];
    if (all.length > room) {
      setCapped(true);
      return;
    }
    onPick(all);
    onOpenChange(false);
  };

  const item = (note: PickedNote, detail?: string) => {
    const on = isPicked(note.id) || attached.has(note.id);
    return (
      <CommandItem key={note.id} value={note.id} disabled={attached.has(note.id)} onSelect={() => toggle(note)}>
        <Check aria-hidden className={cn(!on && "invisible")} />
        <span className="min-w-0 flex-1 truncate">{note.title}</span>
        {detail && <span className="shrink-0 truncate text-xs text-muted-foreground">{detail}</span>}
        <span className="sr-only">{attached.has(note.id) ? ", attached" : on ? ", selected" : ""}</span>
      </CommandItem>
    );
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Attach notes"
      description="Choose notes to send as text with your message."
      commandProps={{ shouldFilter: false }}
      onCloseAutoFocus={(e) => {
        if (onClosed) {
          e.preventDefault();
          onClosed();
        }
      }}
    >
      <CommandInput placeholder="Search notes…" value={q} onValueChange={setQ} aria-label="Search notes" />
      <div className="flex items-center gap-2 border-b border-divider px-3 py-1.5">
        <span className="shrink-0 text-xs text-muted-foreground">
          Browse in
        </span>
        <Select value={course} onValueChange={setCourse}>
          <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 text-xs" aria-label="Browse in course">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All courses and events</SelectItem>
            {courses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} · {c.where}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <CommandList className="max-h-[360px]">
        <CommandEmpty>No notes match.</CommandEmpty>
        {openNote && (!needle || openNote.name.toLowerCase().includes(needle)) && (
          <CommandGroup heading="Open note">
            <CommandItem
              value={`__open-${openNote.id}`}
              disabled={attached.has(openNote.id)}
              onSelect={() => finish([{ id: openNote.id, title: openNote.name }])}
            >
              <NotePencil aria-hidden />
              <span className="min-w-0 flex-1 truncate">Attach the open note: {openNote.name}</span>
            </CommandItem>
          </CommandGroup>
        )}
        {sessionNotes.length > 0 && (
          <CommandGroup heading="This session">{sessionNotes.map((n) => item({ id: n.id, title: n.name }))}</CommandGroup>
        )}
        {others.length > 0 && (
          <CommandGroup heading="Browse">{others.map((h) => item({ id: h.id, title: h.title }, h.sessionLabel))}</CommandGroup>
        )}
      </CommandList>
      {browse.isSuccess && !others.length && <p className="px-3 py-1.5 text-xs text-muted-foreground">No notes in other sessions match.</p>}
      {browse.isError && (
        <p role="alert" className="px-3 py-1.5 text-xs text-danger">
          Couldn't search the notes.
        </p>
      )}
      <div className="flex items-center gap-2 border-t border-divider p-2">
        <p role="status" className={cn("min-w-0 flex-1 text-xs", capped ? "text-danger" : "text-muted-foreground")}>
          {capped ? CAP_MESSAGE : picked.length ? `${picked.length} selected` : ""}
        </p>
        <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!picked.length} onClick={() => finish()}>
          {picked.length > 1 ? `Attach ${picked.length} notes` : "Attach"}
        </Button>
      </div>
    </CommandDialog>
  );
}
