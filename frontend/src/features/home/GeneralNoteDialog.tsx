/**
 * The general-note pop-up (018 FR-004–FR-008): a bounded box over the home page with the session
 * notes' editor and autosave, but none of the session tools, so it reads as a scratchpad.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchNote, saveNoteContent, usePreferences, type Note, type NoteMeta } from "@/features/sessions/api";
import { ensureSaver, getSaver, readDraft, removeSaver, useSaveStatus, type SaveFn } from "@/features/sessions/autosave";
import { ConflictDialog } from "@/features/sessions/ConflictDialog";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/features/sessions/editor/MarkdownEditor";
import { DeleteNoteDialog, NoteNameDialog } from "@/features/sessions/NoteDialogs";
import { StatusLabel } from "@/features/sessions/WorkspaceTabs";
import { apiFetch, isApiError } from "@/lib/api";
import { AUTO_NAME, generalNotesKey, nameFromText } from "./generalNotesApi";

const saveFn: SaveFn = (id, content, version, baseHash, keepalive) =>
  saveNoteContent(id, content, version, baseHash, keepalive).then((r) => ({ version: r.version, hash: r.hash }));

async function loadNote(id: string): Promise<Note> {
  const note = await fetchNote(id);
  if (!getSaver(id)) {
    const saver = ensureSaver(id, { content: note.content, version: note.version, hash: note.hash }, saveFn);
    const draft = readDraft(id);
    if (draft && draft.content !== note.content && draft.baseVersion === note.version) saver.update(draft.content);
  }
  return note;
}

const rename = (id: string, name: string, version: number) =>
  apiFetch<NoteMeta>(`/notes/${encodeURIComponent(id)}`, { method: "PATCH", body: { name }, version });
const remove = (id: string, version: number) =>
  apiFetch<void>(`/notes/${encodeURIComponent(id)}`, { method: "DELETE", version });

/** Clicks and keys inside the editor's own popups (links, tables, diagrams) are not "outside". */
const inEditorPopup = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest(".mdxeditor-popup-container, [data-radix-popper-content-wrapper]");

interface Props {
  noteId: string;
  /** Created by this opening: discarded on close while still blank (FR-015). */
  createdHere: boolean;
  onClose: () => void;
}

export function GeneralNoteDialog({ noteId, createdHere, onClose }: Props) {
  const qc = useQueryClient();
  const prefs = usePreferences();
  const query = useQuery({ queryKey: ["note", noteId], queryFn: () => loadNote(noteId), staleTime: Infinity });
  const editor = useRef<MarkdownEditorHandle>(null);
  const [name, setName] = useState<string>();
  const [sub, setSub] = useState<"rename" | "delete" | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const snap = useSaveStatus(getSaver(noteId));
  const note = query.data;
  const title = name ?? note?.name ?? "General note";

  const finish = () => {
    removeSaver(noteId);
    qc.removeQueries({ queryKey: ["note", noteId] });
    void qc.invalidateQueries({ queryKey: generalNotesKey });
    onClose();
  };

  // flush first (Principle I); a failed save keeps the box open with the text in it
  const close = async () => {
    const saver = getSaver(noteId);
    if (busy) return;
    if (!saver) return finish();
    setBusy(true);
    try {
      await saver.flush();
      if (saver.pending) {
        setError("Not saved — check the connection and try again.");
        return;
      }
      const text = saver.content;
      if (createdHere && !text.trim()) {
        await remove(noteId, saver.version).catch(() => {});
      } else if (AUTO_NAME.test(title) && nameFromText(text)) {
        await rename(noteId, nameFromText(text), saver.version).catch(() => {}); // taken: keep the auto name
      }
      finish();
    } finally {
      setBusy(false);
    }
  };

  const keepBoth = async () => {
    const saver = getSaver(noteId);
    if (!saver) return;
    for (let i = 1; i < 20; i++) {
      try {
        const base = `${title} (my version)`;
        const copy = await apiFetch<Note>("/general-notes", {
          method: "POST",
          body: { name: i === 1 ? base : `${base} ${i}`, content: saver.content },
        });
        saver.adoptTheirsAfterCopy();
        toast.success(`Your text was saved as “${copy.name}”.`);
        return finish();
      } catch (err) {
        if (!isApiError(err, "name_taken")) throw err;
      }
    }
  };

  const saver = getSaver(noteId);
  return (
    <Dialog open onOpenChange={(open) => !open && void close()}>
      <DialogContent
        className="flex h-[min(520px,85vh)] flex-col gap-3 p-4 sm:max-w-2xl"
        onInteractOutside={(e) => inEditorPopup(e.target) && e.preventDefault()}
        onEscapeKeyDown={(e) => inEditorPopup(document.activeElement) && e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()} // the section returns focus to the opener
      >
        <DialogHeader className="gap-1 pr-8">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="secondary">General note</Badge>
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
          </div>
          <DialogDescription>General note — not linked to any class. Lecture notes go in a class session.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-divider bg-editor-surface">
          {note && saver ? (
            <MarkdownEditor
              ref={editor}
              noteId={noteId}
              initialContent={saver.content}
              label={`${title} — general note`}
              mode={prefs.data?.editorMode ?? "live"}
              onChange={(id, text) => getSaver(id)?.update(text)}
            />
          ) : (
            <p role="status" className="grid h-full place-items-center text-sm text-muted-foreground">
              {query.isError ? "Couldn't open this note." : "Opening note…"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span aria-live="polite" data-testid="general-note-save-state">
            {note && <StatusLabel noteId={noteId} />}
          </span>
          {error && <span role="alert" className="text-danger">{error}</span>}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" disabled={!note} onClick={() => setSub("rename")}>Rename</Button>
          <Button variant="ghost" size="sm" disabled={!note} onClick={() => setSub("delete")}>Delete</Button>
          <Button size="sm" disabled={busy} onClick={() => void close()}>Done</Button>
        </div>
      </DialogContent>

      {sub === "rename" && note && (
        <NoteNameDialog
          title="Rename general note"
          description="The Markdown file in General Notes is renamed too."
          submitLabel="Rename"
          initial={title}
          pending={false}
          onClose={() => setSub(null)}
          onSubmit={async (next) => {
            const s = getSaver(noteId);
            await s?.flush();
            const res = await rename(noteId, next, s?.version ?? note.version);
            if (s) s.version = res.version;
            setName(res.name);
            setSub(null);
            void qc.invalidateQueries({ queryKey: generalNotesKey });
          }}
        />
      )}
      {sub === "delete" && note && (
        <DeleteNoteDialog
          name={title}
          fileName={note.fileName}
          where="your General Notes folder"
          pending={busy}
          error={error}
          onClose={() => setSub(null)}
          onConfirm={async () => {
            const s = getSaver(noteId);
            await s?.flush();
            try {
              await remove(noteId, s?.version ?? note.version);
            } catch {
              setError("Couldn't delete the note. Try again.");
              return;
            }
            toast.success(`Deleted “${title}”.`);
            finish();
          }}
        />
      )}
      {saver && snap?.status === "conflict" && snap.conflict && (
        <ConflictDialog
          noteName={title}
          conflict={snap.conflict}
          mine={saver.content}
          onKeepBoth={keepBoth}
          onUseMine={() => saver.useMine()}
          onUseTheirs={() => editor.current?.replaceContent(noteId, saver.useTheirs())}
        />
      )}
    </Dialog>
  );
}
