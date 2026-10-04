import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSession } from "@/features/classes/api";
import { isApiError } from "@/lib/api";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import {
  fetchNote, fetchWorkspace, notesKey, putWorkspace, saveNoteContent, useCreateNote, useDeleteNote,
  useNotes, usePreferences, useRenameNote, useTimeline, useUpdatePreferences, type Note, type NoteMeta,
} from "./api";
import { ensureSaver, getSaver, readDraft, removeSaver, useSaveStatus, type SaveFn } from "./autosave";
import { ConflictDialog } from "./ConflictDialog";
import { MarkdownEditor, type EditorMode, type MarkdownEditorHandle } from "./editor/MarkdownEditor";
import { NoteList } from "./NoteList";
import { DeleteNoteDialog, NoteNameDialog } from "./NoteDialogs";
import { NoteTabs, StatusLabel } from "./NoteTabs";
import { SessionTimeline } from "./SessionTimeline";
import { useWorkspaceKeyboard } from "./useWorkspaceKeyboard";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { useWorkspacePanels } from "./workspace-panels";

const saveFn: SaveFn = (id, content, version, baseHash, keepalive) =>
  saveNoteContent(id, content, version, baseHash, keepalive).then((r) => ({ version: r.version, hash: r.hash }));

/** Fetch a note and set up its autosaver once; restore a local draft left by a crash/reload. */
async function loadNote(id: string): Promise<Note> {
  const note = await fetchNote(id);
  if (!getSaver(id)) {
    const saver = ensureSaver(id, { content: note.content, version: note.version, hash: note.hash }, saveFn);
    const draft = readDraft(id);
    if (draft && draft.content !== note.content) {
      if (draft.baseVersion === note.version) {
        saver.update(draft.content);
        toast.info(`Restored unsaved text in “${note.name}”.`);
      } else {
        saver.markDraftConflict(draft.content, { version: note.version, hash: note.hash, content: note.content });
      }
    }
  }
  return note;
}

interface Tabs {
  open: string[];
  active: string | null;
  sessionKey: string | null;
}

function RightPanel({ sessionKey }: { sessionKey: string }) {
  const panels = useWorkspacePanels();
  if (!panels.length)
    return (
      <section aria-labelledby="audio-heading" className="grid gap-2 p-4">
        <h2 id="audio-heading" className="text-sm font-semibold">Audio</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">Recordings arrive in the next update.</p>
      </section>
    );
  return (
    <>
      {panels.map(({ id, title, component: P }) => (
        <section key={id} aria-label={title} className="min-h-0">
          <P sessionKey={sessionKey} />
        </section>
      ))}
    </>
  );
}

/** Session workspace (FR-007–FR-024): sessions + notes | tabs + editor | audio. */
export function WorkspacePage() {
  const { courseId = "", sessionKey = "" } = useParams();
  const qc = useQueryClient();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const session = useSession(sessionKey);
  const timeline = useTimeline(courseId);
  const notes = useNotes(sessionKey);
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const createNote = useCreateNote(sessionKey);
  const renameNote = useRenameNote(sessionKey);
  const deleteNote = useDeleteNote(sessionKey);
  const editor = useRef<MarkdownEditorHandle>(null);

  const [tabs, setTabs] = useState<Tabs>({ open: [], active: null, sessionKey: null });
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "rename" | "delete"; note: NoteMeta } | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);

  const mode: EditorMode = prefs.data?.editorMode ?? "live";
  const leftOpen = isDesktop ? !prefs.data?.workspaceLeftCollapsed : drawer === "left";
  const rightOpen = isDesktop ? !prefs.data?.workspaceRightCollapsed : drawer === "right";
  const noteList = useMemo(() => notes.data ?? [], [notes.data]);
  const activeId = tabs.sessionKey === sessionKey ? tabs.active : null;
  const openIds = tabs.sessionKey === sessionKey ? tabs.open : [];

  // ---- workspace state per session (FR-013) ----------------------------------------------
  useEffect(() => {
    let live = true;
    fetchWorkspace(sessionKey).then(
      (s) => live && setTabs({ open: s.openNoteIds ?? [], active: s.activeNoteId ?? null, sessionKey }),
      () => live && setTabs({ open: [], active: null, sessionKey }),
    );
    return () => {
      live = false;
    };
  }, [sessionKey]);

  // debounced save of the tab state; a pending save is sent at once when the session changes
  // or the workspace unmounts, so switching quickly never loses tabs (US3 #3)
  const pendingTabs = useRef<{ key: string; open: string[]; active: string | null } | null>(null);
  const sendPendingTabs = useCallback(() => {
    const p = pendingTabs.current;
    pendingTabs.current = null;
    if (p) void putWorkspace(p.key, { openNoteIds: p.open, activeNoteId: p.active }).catch(() => {});
  }, []);
  useEffect(() => {
    if (tabs.sessionKey !== sessionKey) return;
    pendingTabs.current = { key: sessionKey, open: tabs.open, active: tabs.active };
    const t = window.setTimeout(sendPendingTabs, 500);
    return () => window.clearTimeout(t);
  }, [tabs, sessionKey, sendPendingTabs]);
  useEffect(() => sendPendingTabs, [sessionKey, sendPendingTabs]);


  // ---- tab actions -----------------------------------------------------------------------
  const openNote = useCallback((id: string) => {
    setTabs((t) => ({ ...t, open: t.open.includes(id) ? t.open : [...t.open, id], active: id }));
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      void getSaver(id)?.flush();
      setTabs((t) => {
        const i = t.open.indexOf(id);
        const open = t.open.filter((x) => x !== id);
        const active = t.active === id ? (open[i] ?? open[i - 1] ?? null) : t.active;
        return { ...t, open, active };
      });
    },
    [],
  );

  const cycleTab = useCallback((dir: 1 | -1) => {
    setTabs((t) => {
      if (!t.open.length) return t;
      const i = t.open.indexOf(t.active ?? "");
      return { ...t, active: t.open[(i + dir + t.open.length) % t.open.length] };
    });
  }, []);

  const togglePanel = useCallback(
    (side: "left" | "right") => {
      if (!isDesktop) return setDrawer((d) => (d === side ? null : side));
      const key = side === "left" ? "workspaceLeftCollapsed" : "workspaceRightCollapsed";
      updatePrefs.mutate({ [key]: !(prefs.data?.[key] ?? false) });
    },
    [isDesktop, prefs.data, updatePrefs],
  );

  const toggleMode = useCallback(
    () => updatePrefs.mutate({ editorMode: mode === "live" ? "raw" : "live" }),
    [mode, updatePrefs],
  );

  useWorkspaceKeyboard({
    newNote: () => setDialog({ kind: "new" }),
    closeTab: () => activeId && closeTab(activeId),
    nextTab: () => cycleTab(1),
    prevTab: () => cycleTab(-1),
    toggleLeft: () => togglePanel("left"),
    toggleRight: () => togglePanel("right"),
  });

  // ---- active note + conflicts ------------------------------------------------------------
  const activeMeta = noteList.find((n) => n.id === activeId);
  const activeQuery = useQuery({
    queryKey: ["note", activeId],
    queryFn: () => loadNote(activeId!),
    enabled: !!activeId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const activeNote = activeQuery.data;
  const activeSaver = activeId ? getSaver(activeId) : undefined;
  const activeSnap = useSaveStatus(activeSaver);

  const keepBoth = async () => {
    if (!activeSaver || !activeMeta) return;
    const base = `${activeMeta.name} (my version)`;
    let created: Note | null = null;
    for (let i = 1; i < 20 && !created; i++) {
      try {
        created = await createNote.mutateAsync({ name: i === 1 ? base : `${base} ${i}`, content: activeSaver.content });
      } catch (err) {
        if (!isApiError(err, "name_taken")) throw err;
      }
    }
    if (!created) return;
    ensureSaver(created.id, { content: created.content, version: created.version, hash: created.hash }, saveFn);
    const text = activeSaver.adoptTheirsAfterCopy();
    editor.current?.replaceContent(activeSaver.noteId, text);
    openNote(created.id);
    toast.success(`Your text was saved as “${created.name}”.`);
  };

  const useTheirs = () => {
    if (!activeSaver) return;
    const text = activeSaver.useTheirs();
    editor.current?.replaceContent(activeSaver.noteId, text);
  };

  // ---- layout -----------------------------------------------------------------------------
  const left = (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto py-3">
      <NoteList
        notes={noteList}
        openIds={openIds}
        activeId={activeId}
        loading={notes.isPending}
        onNew={() => setDialog({ kind: "new" })}
        onOpen={openNote}
        onRename={(note) => setDialog({ kind: "rename", note })}
        onDelete={(note) => {
          setDeleteError(undefined);
          setDialog({ kind: "delete", note });
        }}
      />
      <nav aria-label="Sessions of this course" className="min-h-0 border-t border-divider pt-3">
        <h2 className="px-2 pb-1 text-xs font-semibold text-muted-foreground">Sessions</h2>
        {timeline.data && <SessionTimeline entries={timeline.data.entries} variant="compact" activeKey={sessionKey} />}
      </nav>
    </div>
  );

  const editorArea = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-end justify-between gap-2 bg-surface">
        <NoteTabs notes={noteList} openIds={openIds} activeId={activeId} onSelect={openNote} onClose={closeTab} />
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && v !== mode && toggleMode()}
          aria-label="Editing mode"
          className="mr-2 mb-1 shrink-0"
        >
          <ToggleGroupItem value="live" aria-keyshortcuts="Control+E Meta+E">Live</ToggleGroupItem>
          <ToggleGroupItem value="raw" aria-keyshortcuts="Control+E Meta+E">Raw</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div
        id="note-editor-panel"
        role="tabpanel"
        aria-labelledby={activeId ? `tab-${activeId}` : undefined}
        className="relative min-h-0 flex-1 bg-surface-elevated"
      >
        {activeId && activeNote && activeMeta ? (
          <>
            {activeNote.missing && activeSnap?.status !== "conflict" && (
              <p role="status" className="border-b border-divider px-4 py-2 text-sm text-warning">
                This note's file is missing on disk. Typing will save it again.
              </p>
            )}
            <MarkdownEditor
              ref={editor}
              noteId={activeId}
              initialContent={getSaver(activeId)?.content ?? activeNote.content}
              label={`${activeMeta.name} — Markdown note`}
              mode={mode}
              onChange={(id, text) => getSaver(id)?.update(text)}
              onToggleMode={toggleMode}
              onEscape={() => document.getElementById(`tab-${activeId}`)?.focus()}
            />
            <p className="pointer-events-none absolute right-3 bottom-2 text-xs" aria-live="polite">
              <StatusLabel noteId={activeId} />
            </p>
          </>
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="grid max-w-sm gap-3">
              <p className="text-sm text-muted-foreground">
                {activeId ? "Opening note…" : noteList.length ? "Choose a note on the left, or start a new one." : "No notes for this session yet."}
              </p>
              {!activeId && (
                <button type="button" onClick={() => setDialog({ kind: "new" })} className="justify-self-center text-sm font-medium text-primary underline underline-offset-4">
                  New note <kbd className="ml-1 font-mono text-xs text-muted-foreground">Alt+N</kbd>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <WorkspaceHeader
        courseId={courseId}
        session={session.data}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => togglePanel("left")}
        onToggleRight={() => togglePanel("right")}
      />
      {session.isError ? (
        <p role="alert" className="p-8 text-sm text-danger">This session doesn't exist.</p>
      ) : (
        <div
          className="grid min-h-0 flex-1"
          style={{
            gridTemplateColumns: isDesktop
              ? `${leftOpen ? "240px " : ""}minmax(0,1fr)${rightOpen ? " 300px" : ""}`
              : "minmax(0,1fr)",
          }}
        >
          {isDesktop && leftOpen && <aside aria-label="Sessions and notes" className="min-h-0 border-r border-divider bg-surface">{left}</aside>}
          <main className={cn("min-h-0 min-w-0")} aria-label="Notes">{editorArea}</main>
          {isDesktop && rightOpen && (
            <aside aria-label="Audio" className="min-h-0 overflow-y-auto border-l border-divider bg-surface">
              <RightPanel sessionKey={sessionKey} />
            </aside>
          )}
        </div>
      )}

      {!isDesktop && (
        <Sheet open={drawer !== null} onOpenChange={(o) => !o && setDrawer(null)}>
          <SheetContent side={drawer === "right" ? "right" : "left"} className="w-[min(320px,88vw)] p-0">
            <SheetTitle className="sr-only">{drawer === "right" ? "Audio" : "Sessions and notes"}</SheetTitle>
            <SheetDescription className="sr-only">Workspace panel</SheetDescription>
            {drawer === "right" ? <RightPanel sessionKey={sessionKey} /> : left}
          </SheetContent>
        </Sheet>
      )}

      {dialog?.kind === "new" && (
        <NoteNameDialog
          title="New note"
          description="Notes are saved as Markdown files in this session's notes folder."
          submitLabel="Create note"
          pending={createNote.isPending}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const note = await createNote.mutateAsync({ name });
            ensureSaver(note.id, { content: note.content, version: note.version, hash: note.hash }, saveFn);
            setDialog(null);
            openNote(note.id);
            requestAnimationFrame(() => requestAnimationFrame(() => editor.current?.focus()));
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <NoteNameDialog
          title="Rename note"
          description="The Markdown file is renamed too."
          submitLabel="Rename"
          initial={dialog.note.name}
          pending={renameNote.isPending}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const saver = getSaver(dialog.note.id);
            await saver?.flush();
            const res = await renameNote.mutateAsync({ id: dialog.note.id, name, version: saver?.version ?? dialog.note.version });
            if (saver) saver.version = res.version;
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteNoteDialog
          name={dialog.note.name}
          fileName={dialog.note.fileName}
          pending={deleteNote.isPending}
          error={deleteError}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const { note } = dialog;
            const saver = getSaver(note.id);
            await saver?.flush();
            try {
              await deleteNote.mutateAsync({ id: note.id, version: saver?.version ?? note.version });
            } catch (err) {
              setDeleteError(isApiError(err, "version_conflict") ? "The note changed meanwhile. Reload and try again." : "Couldn't delete the note.");
              await qc.invalidateQueries({ queryKey: notesKey(sessionKey) });
              return;
            }
            removeSaver(note.id);
            editor.current?.forget(note.id);
            closeTab(note.id);
            setDialog(null);
            toast.success(`Deleted “${note.name}”.`);
          }}
        />
      )}
      {activeSaver && activeSnap?.status === "conflict" && activeSnap.conflict && activeMeta && (
        <ConflictDialog
          noteName={activeMeta.name}
          conflict={activeSnap.conflict}
          mine={activeSaver.content}
          onKeepBoth={keepBoth}
          onUseMine={() => activeSaver.useMine()}
          onUseTheirs={useTheirs}
        />
      )}
    </div>
  );
}
