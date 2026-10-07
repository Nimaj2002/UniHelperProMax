import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { createNote, importReplaceNote, notesKey, type Note, type NoteMeta } from "@/features/sessions/api";
import { getSaver } from "@/features/sessions/autosave";
import { showImportSummary, type SummaryRow } from "./ImportSummaryDialog";
import { NoteConflictDialog, ReplaceConfirmDialog } from "./NoteConflictDialogs";
import { NOTE_ACCEPT } from "./noteFiles";
import { runNoteImport, type ConflictChoice, type ConflictPrompt, type NoteImportResult } from "./noteImport";

function row(r: NoteImportResult): SummaryRow {
  switch (r.outcome) {
    case "imported":
      return { fileName: r.fileName, outcome: "Imported" };
    case "renamed":
      return { fileName: r.fileName, outcome: `Imported as “${r.name}”` };
    case "replaced":
      return { fileName: r.fileName, outcome: `Replaced “${r.name}”` };
    case "skipped":
      return { fileName: r.fileName, outcome: "Skipped" };
    default:
      return { fileName: r.fileName, outcome: "Not imported", detail: r.detail };
  }
}

function announce(results: NoteImportResult[]) {
  if (!results.length) return;
  const ok = results.filter((r) => r.outcome === "imported" || r.outcome === "renamed" || r.outcome === "replaced").length;
  if (results.length === 1) {
    const [r] = results;
    if (r.outcome === "rejected") toast.error(r.detail ?? `${r.fileName} wasn't imported.`);
    else if (r.outcome === "skipped") toast.info(`Skipped “${r.fileName}”.`);
    else toast.success(r.outcome === "replaced" ? `Replaced “${r.name}”` : `Imported “${r.name}”`);
    return;
  }
  const text = `Imported ${ok} of ${results.length} notes`;
  const action = { label: "Details", onClick: () => showImportSummary(text, results.map(row)) };
  if (ok === results.length) toast.success(text, { action });
  else toast.warning(text, { action });
}

interface Options {
  sessionKey: string;
  notes: NoteMeta[];
  onOpen: (noteId: string) => void;
}

/** "Import note": picker, conflict prompts, and the run itself (006 US4/US5). */
export function useNoteImporter({ sessionKey, notes, onOpen }: Options) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [conflict, setConflict] = useState<{ prompt: ConflictPrompt; resolve: (v: { choice: ConflictChoice; applyToAll: boolean }) => void } | null>(null);
  const [confirm, setConfirm] = useState<{ names: string[]; resolve: (ok: boolean) => void } | null>(null);
  const [running, setRunning] = useState(false);

  const adoptReplaced = (note: Note) => {
    const saver = getSaver(note.id);
    if (saver?.adoptServerReplace({ content: note.content, hash: note.hash, version: note.version })) {
      qc.setQueryData<Note>(["note", note.id], (old) => (old ? { ...old, ...note } : old));
    } else {
      qc.removeQueries({ queryKey: ["note", note.id] }); // loaded fresh when opened
    }
  };

  const run = async (files: File[]) => {
    if (!files.length || running) return;
    setRunning(true);
    try {
      const results = await runNoteImport({
        files,
        notes,
        api: {
          create: (name, content) => createNote(sessionKey, name, content),
          replace: (id, version, content) => importReplaceNote(id, version, content),
        },
        ui: {
          resolveConflict: (prompt) => new Promise((resolve) => setConflict({ prompt, resolve })),
          confirmReplace: (names) => new Promise((resolve) => setConfirm({ names, resolve })),
        },
        replaceBlocked: (noteId, name) => {
          const saver = getSaver(noteId);
          return saver && saver.status !== "saved" ? `“${name}” has unsaved changes. Wait until it says Saved, then try again.` : null;
        },
        onCreated: () => {
          void qc.invalidateQueries({ queryKey: notesKey(sessionKey) });
          void qc.invalidateQueries({ queryKey: ["timeline"] });
        },
        onReplaced: (note) => {
          adoptReplaced(note);
          void qc.invalidateQueries({ queryKey: notesKey(sessionKey) });
        },
      });
      announce(results);
      const created = results.filter((r) => (r.outcome === "imported" || r.outcome === "renamed") && r.note);
      if (results.length === 1 && created.length === 1) onOpen(created[0].note!.id);
    } finally {
      setRunning(false);
    }
  };

  const element = (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={NOTE_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        data-testid="import-note-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void run(files);
        }}
      />
      {conflict && (
        <NoteConflictDialog
          key={conflict.prompt.fileName + conflict.prompt.name}
          prompt={conflict.prompt}
          onChoose={(choice, applyToAll) => {
            setConflict(null);
            conflict.resolve({ choice, applyToAll });
          }}
        />
      )}
      {confirm && (
        <ReplaceConfirmDialog
          names={confirm.names}
          onAnswer={(ok) => {
            setConfirm(null);
            confirm.resolve(ok);
          }}
        />
      )}
    </>
  );

  return { pick: () => input.current?.click(), run, running, element };
}
