import { DotsThree, NotePencil, Plus, UploadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { File } from "@/components/ui/file-tree";
import { hintOf, useKeymap } from "@/lib/keymap";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NoteMeta } from "./api";
import { AddCircleButton, FileTreeList } from "./FileTreeList";

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

/** The session's notes in creation order (FR-016); open notes are marked. Its "Notes" header is
 * the left panel's collapsible section. */
export function NoteList({ notes, openIds, activeId, loading, onNew, onImport, importing, onOpen, onRename, onDelete }: Props) {
  const keymap = useKeymap();
  const [adding, setAdding] = useState(false);
  const choose = (fn?: () => void) => {
    setAdding(false);
    fn?.();
  };
  return (
    <div className="grid gap-1">
      <div className="flex justify-end px-2">
        <AddCircleButton label="Add a note" data-tour="new-note" onClick={() => (onImport ? setAdding(true) : onNew())} />
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Add a note</DialogTitle>
            <DialogDescription>Start an empty note or upload .md / .txt files.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button variant="outline" className="justify-start" onClick={() => choose(onNew)} aria-keyshortcuts={hintOf(keymap, "workspace.newNote").aria}>
              <Plus aria-hidden /> New note
            </Button>
            <Button variant="outline" className="justify-start" disabled={importing} onClick={() => choose(onImport)} aria-keyshortcuts={hintOf(keymap, "workspace.importNote").aria}>
              <UploadSimple aria-hidden /> Upload note
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {loading && <p className="px-2 text-sm text-muted-foreground">Loading…</p>}
      {!loading && notes.length === 0 && <p className="px-2 text-sm text-muted-foreground">No notes yet.</p>}
      {notes.length > 0 && (
        <FileTreeList label="Notes" count={notes.length}>
          {notes.map((n) => {
            const open = openIds.includes(n.id);
            return (
              <div key={n.id} className="group flex items-center gap-0.5">
                <File
                  value={n.id}
                  isSelect={n.id === activeId}
                  fileIcon={<NotePencil size={16} aria-hidden />}
                  handleSelect={() => onOpen(n.id)}
                  aria-current={n.id === activeId ? "true" : undefined}
                  title={n.name}
                  className={cn("w-full min-w-0 flex-1 py-1 pl-1 hover:bg-accent", n.id === activeId && "font-medium")}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{n.name}</span>
                  {open && <span className="sr-only">(open)</span>}
                  {open && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />}
                </File>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-70 hover:opacity-100" aria-label={`Actions for ${n.name}`}>
                      <DotsThree size={18} weight="bold" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onRename(n)}>Rename…</DropdownMenuItem>
                    <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => onDelete(n)}>Delete…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </FileTreeList>
      )}
    </div>
  );
}
