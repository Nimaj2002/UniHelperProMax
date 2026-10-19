import { FilePdf, NotePencil, Plus, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PDF_ACCEPT } from "@/features/documents/pdfFiles";
import { documentQueue } from "@/features/documents/queue";

type Kind = "document" | "note";

interface Item {
  id: string;
  name: string;
}

interface Props {
  sessionKey: string;
  notes: Item[];
  documents: Item[];
  /** Ids of notes/documents already open in a tab (marked in the picker). */
  openIds: Set<string>;
  onOpen: (kind: Kind, id: string) => void;
  onNewNote: () => void;
  onImportNote: () => void;
}

const LABEL: Record<Kind, { title: string; empty: string; search: string }> = {
  document: { title: "Open a PDF", empty: "No PDFs in this session.", search: "Search PDFs…" },
  note: { title: "Open a note", empty: "No notes in this session.", search: "Search notes…" },
};

/**
 * "+" at the end of the tab row: choose PDF or note, then pick one of this session's to open in a
 * tab — or add a new one (new/imported note, uploaded PDF), which opens once it exists.
 */
export function AddTabButton({ sessionKey, notes, documents, openIds, onOpen, onNewNote, onImportNote }: Props) {
  const [picking, setPicking] = useState<Kind | null>(null);
  const items = picking === "document" ? documents : notes;
  const Icon = picking === "document" ? FilePdf : NotePencil;
  const pdfInput = useRef<HTMLInputElement>(null);

  // PDFs uploaded from here open in a tab when their upload finishes
  const batches = useRef(new Set<string>());
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  });
  useEffect(
    () =>
      documentQueue().onEvent((e) => {
        if (e.type === "done" && e.entry.resultId && batches.current.has(e.entry.batchId)) openRef.current("document", e.entry.resultId);
      }),
    [],
  );

  const act = (fn: () => void) => {
    setPicking(null);
    fn();
  };

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Open a tab"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus size={16} aria-hidden />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Open a PDF or note</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setPicking("document")}>
            <FilePdf aria-hidden /> PDF
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicking("note")}>
            <NotePencil aria-hidden /> Note
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CommandDialog
        open={picking !== null}
        onOpenChange={(o) => !o && setPicking(null)}
        title={picking ? LABEL[picking].title : undefined}
        description={picking ? LABEL[picking].search : undefined}
      >
        {picking && (
          <>
            <CommandInput placeholder={LABEL[picking].search} />
            <CommandList>
              <CommandEmpty>{items.length ? "No matches." : LABEL[picking].empty}</CommandEmpty>
              <CommandGroup heading="Add">
                {picking === "note" ? (
                  <>
                    <CommandItem value="__new-note" forceMount onSelect={() => act(onNewNote)}>
                      <Plus aria-hidden /> New note
                    </CommandItem>
                    <CommandItem value="__import-note" forceMount onSelect={() => act(onImportNote)}>
                      <UploadSimple aria-hidden /> Upload note
                    </CommandItem>
                  </>
                ) : (
                  <CommandItem value="__upload-pdf" forceMount onSelect={() => act(() => pdfInput.current?.click())}>
                    <UploadSimple aria-hidden /> Upload PDF
                  </CommandItem>
                )}
              </CommandGroup>
              <CommandGroup heading={picking === "document" ? "PDFs" : "Notes"}>
                {items.map((it) => (
                  <CommandItem
                    key={it.id}
                    value={it.id}
                    keywords={[it.name]}
                    onSelect={() => {
                      onOpen(picking, it.id);
                      setPicking(null);
                    }}
                  >
                    <Icon aria-hidden />
                    <span className="truncate">{it.name}</span>
                    {openIds.has(it.id) && <span className="ml-auto text-xs text-muted-foreground">Open</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </>
        )}
      </CommandDialog>
      <input
        ref={pdfInput}
        type="file"
        multiple
        accept={PDF_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) batches.current.add(documentQueue().enqueue(sessionKey, files));
        }}
      />
    </>
  );
}
