import { DotsThree, Plus, UploadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NoteMeta } from "./api";

interface Props {
  notes: NoteMeta[];
  openIds: string[];
  activeId: string | null;
  loading: boolean;
  onNew: () => void;
  /** 006: pick .md/.txt files to import as notes */
  onImport?: () => void;
  importing?: boolean;
  onOpen: (id: string) => void;
  onRename: (note: NoteMeta) => void;
  onDelete: (note: NoteMeta) => void;
}

/** The session's notes in creation order (FR-016); open notes are marked. */
export function NoteList({ notes, openIds, activeId, loading, onNew, onImport, importing, onOpen, onRename, onDelete }: Props) {
  return (
    <section aria-labelledby="notes-heading" className="grid gap-2">
      <div className="flex items-center justify-between px-2">
        <h2 id="notes-heading" className="text-xs font-semibold text-muted-foreground">Notes</h2>
      </div>
      <div className="mx-2 grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" className="justify-start" onClick={onNew} aria-keyshortcuts="Alt+N">
          <Plus size={14} aria-hidden /> New note
        </Button>
        {onImport && (
          <Button size="sm" variant="outline" className="justify-start" onClick={onImport} disabled={importing} aria-keyshortcuts="Alt+Shift+N">
            <UploadSimple size={14} aria-hidden /> Import note
          </Button>
        )}
      </div>
      {loading && <p className="px-2 text-sm text-muted-foreground">Loading…</p>}
      {!loading && notes.length === 0 && <p className="px-2 text-sm text-muted-foreground">No notes yet.</p>}
      <ul className="grid gap-0.5">
        {notes.map((n) => {
          const open = openIds.includes(n.id);
          return (
            <li key={n.id} className="group flex items-center gap-0.5 px-1">
              <button
                type="button"
                onClick={() => onOpen(n.id)}
                aria-current={n.id === activeId ? "true" : undefined}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  n.id === activeId && "bg-accent font-medium",
                )}
                title={n.name}
              >
                {n.name}
                {open && " "}
                {open && <span className="sr-only">(open)</span>}
                {open && <span aria-hidden className="ml-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" />}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7 opacity-70 hover:opacity-100" aria-label={`Actions for ${n.name}`}>
                    <DotsThree size={18} weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onRename(n)}>Rename…</DropdownMenuItem>
                  <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => onDelete(n)}>Delete…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
