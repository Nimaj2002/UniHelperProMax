import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { CollapsibleSection, usePanelSections, type PanelSection } from "@/app/shell/panelSection";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSession } from "@/features/classes/api";
import { useDocuments } from "@/features/documents/api";
import { confirmCloseDocument } from "@/features/documents/leaveGuards";
import { DOC_ATTACH, DOC_DETACH, DocumentTabView } from "@/features/documents/reader/DocumentTabView";
import { useNoteImporter } from "@/features/imports/useNoteImporter";
import { isApiError } from "@/lib/api";
import { readLocal, writeLocal } from "@/lib/storage";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import {
  fetchNote, fetchWorkspace, notesKey, putWorkspace, saveNoteContent, useCreateNote, useDeleteNote,
  useNotes, usePreferences, useRenameNote, useTimeline, useUpdatePreferences, type Note, type NoteMeta,
} from "./api";
import { ensureSaver, getSaver, onServerAppend, onServerReplace, readDraft, removeSaver, useSaveStatus, type SaveFn } from "./autosave";
import { ConflictDialog } from "./ConflictDialog";
import { MarkdownEditor, type EditorMode, type MarkdownEditorHandle } from "./editor/MarkdownEditor";
import { NoteList } from "./NoteList";
import { DeleteNoteDialog, NoteNameDialog } from "./NoteDialogs";
import { SessionTimeline } from "./SessionTimeline";
import { useWorkspaceKeyboard } from "./useWorkspaceKeyboard";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { paneId, StatusLabel, tabDomId, WorkspaceTabs } from "./WorkspaceTabs";
import {
  EMPTY, fromServer, panes, reduceTabs, same, toServer, type Side, type TabAction, type TabRef, type WorkspaceTabs as TabsState,
} from "./tabState";
import { useSidePanelSections, useWorkspacePanels } from "./workspace-panels";

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

const RIGHT_DEFAULT = 300;
const RIGHT_MIN = 260;
const RIGHT_MAX = 640;
const EDITOR_MIN = 360;
const RIGHT_WIDTH_KEY = "uh.workspace.rightWidth";

/** Audio panel width, remembered in this browser (a per-device layout convenience). */
function useRightWidth() {
  const [width, setWidth] = useState(() => {
    const v = readLocal(RIGHT_WIDTH_KEY, RIGHT_DEFAULT);
    return v >= RIGHT_MIN && v <= RIGHT_MAX ? v : RIGHT_DEFAULT;
  });
  useEffect(() => writeLocal(RIGHT_WIDTH_KEY, width), [width]);
  return [width, setWidth] as const;
}

/**
 * Editor | audio columns. Owns the audio panel's width, so committing a resize re-renders only
 * this wrapper (its children are unchanged elements), not the whole workspace.
 */
function AudioColumns({ desktop, rightOpen, panel, children }: { desktop: boolean; rightOpen: boolean; panel: ReactNode; children: ReactNode }) {
  const [width, setWidth] = useRightWidth();
  const grid = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={grid}
      className="grid min-h-0 flex-1"
      style={{
        "--audio-w": `${width}px`,
        // the editor always keeps at least EDITOR_MIN px, also while the window resizes
        gridTemplateColumns: desktop
          ? `minmax(0,1fr)${rightOpen ? ` min(var(--audio-w), max(${RIGHT_MIN}px, 100% - ${EDITOR_MIN}px))` : ""}`
          : "minmax(0,1fr)",
      } as CSSProperties}
    >
      {children}
      {desktop && rightOpen && (
        <div className="relative min-h-0 min-w-0">
          <PanelResizeHandle
            value={width}
            min={RIGHT_MIN}
            max={RIGHT_MAX}
            limit={() => (grid.current?.clientWidth ?? Infinity) - EDITOR_MIN}
            defaultValue={RIGHT_DEFAULT}
            onResize={setWidth}
            onDrag={(w) => grid.current?.style.setProperty("--audio-w", `${w}px`)}
            grow="left"
            label="Resize audio panel"
            controls="workspace-audio-panel"
            className="left-0"
          />
          {panel}
        </div>
      )}
    </div>
  );
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
        <section key={id} aria-label={title} className="min-h-0 min-w-0">
          <P sessionKey={sessionKey} />
        </section>
      ))}
    </>
  );
}


const SPLIT_MIN_WIDTH = 1100;

/** Width of an element, kept up to date (split view is offered from 1100 px, 007 FR-014a). */
function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * Shows a document's reader in a pane. Each open document renders once into its own host element
 * (`hosts`), which this slot borrows while it shows that document, so the reader keeps page,
 * zoom and scroll across tab switches and moves between panes (research R11).
 */
function DocSlot({ host, parking }: { host: HTMLElement; parking: RefObject<HTMLElement | null> }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    slot.current?.appendChild(host);
    // moving a node resets its scroll offsets: the reader saves and restores its view (R11)
    host.dispatchEvent(new Event(DOC_ATTACH));
    const park = parking.current;
    return () => {
      host.dispatchEvent(new Event(DOC_DETACH));
      park?.appendChild(host);
    };
  }, [host, parking]);
  return <div ref={slot} className="h-full min-h-0" />;
}

interface NotePaneProps {
  noteId: string;
  meta: NoteMeta | undefined;
  visible: boolean;
  mode: EditorMode;
  editorRef: RefObject<MarkdownEditorHandle | null>;
  onToggleMode: () => void;
}

/** One pane's note editor; stays mounted (hidden) while the pane shows a document. */
function NotePane({ noteId, meta, visible, mode, editorRef, onToggleMode }: NotePaneProps) {
  const query = useQuery({ queryKey: ["note", noteId], queryFn: () => loadNote(noteId), staleTime: Infinity, gcTime: Infinity });
  const note = query.data;
  const snap = useSaveStatus(getSaver(noteId));
  if (!note || !meta) {
    return visible ? <p className="grid h-full place-items-center p-8 text-sm text-muted-foreground">Opening note…</p> : null;
  }
  return (
    <div className={cn("relative flex h-full min-h-0 flex-col bg-editor-surface", !visible && "hidden")}>
      {note.missing && snap?.status !== "conflict" && (
        <p role="status" className="border-b border-divider px-4 py-2 text-sm text-warning">
          This note's file is missing on disk. Typing will save it again.
        </p>
      )}
      <div className="min-h-0 flex-1">
        <MarkdownEditor
          ref={editorRef}
          noteId={noteId}
          initialContent={getSaver(noteId)?.content ?? note.content}
          label={`${meta.name} — Markdown note`}
          mode={mode}
          onChange={(id, text) => getSaver(id)?.update(text)}
          onToggleMode={onToggleMode}
          onEscape={() => document.getElementById(tabDomId({ kind: "note", id: noteId }))?.focus()}
        />
      </div>
      <p className="pointer-events-none absolute right-3 bottom-2 text-xs" aria-live="polite">
        <StatusLabel noteId={noteId} />
      </p>
    </div>
  );
}

/** Session workspace (FR-007–FR-024, 007 FR-011–FR-014a): sessions + notes | tabs + panes | audio. */
export function WorkspacePage() {
  const { courseId = "", sessionKey = "" } = useParams();
  const [searchParams] = useSearchParams();
  const linkedNote = searchParams.get("note");
  const qc = useQueryClient();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const session = useSession(sessionKey);
  const timeline = useTimeline(courseId);
  const notes = useNotes(sessionKey);
  const documents = useDocuments(sessionKey);
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const createNote = useCreateNote(sessionKey);
  const renameNote = useRenameNote(sessionKey);
  const deleteNote = useDeleteNote(sessionKey);
  const leftEditor = useRef<MarkdownEditorHandle>(null);
  const rightEditor = useRef<MarkdownEditorHandle>(null);
  const editors = useMemo(() => ({ left: leftEditor, right: rightEditor }), []);
  const eachEditor = useCallback((fn: (e: MarkdownEditorHandle) => void) => {
    for (const r of [leftEditor, rightEditor]) if (r.current) fn(r.current);
  }, []);
  const mainRef = useRef<HTMLElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const mainWidth = useElementWidth(mainRef);

  const [tabState, setTabState] = useState<{ ws: TabsState; sessionKey: string | null }>({ ws: EMPTY, sessionKey: null });
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "rename" | "delete"; note: NoteMeta } | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);

  const mode: EditorMode = prefs.data?.editorMode ?? "live";
  // notes, documents and sessions are collapsible sections of the app's left panel (on mobile, of
  // the workspace's drawer)
  const sideSections = useSidePanelSections();
  const leftSections = useMemo<PanelSection[]>(
    () => [{ id: "notes", title: "Notes" }, ...sideSections.map(({ id, title }) => ({ id, title })), { id: "sessions", title: "Sessions" }],
    [sideSections],
  );
  const sidePanel = usePanelSections(isDesktop ? leftSections : null);
  const leftIds = useMemo(() => leftSections.map((s) => s.id), [leftSections]);
  const leftCollapsed = leftIds.every((id) => sidePanel.collapsed[id]);
  const leftOpen = isDesktop ? sidePanel.panelVisible && !leftCollapsed : drawer === "left";
  const rightOpen = isDesktop ? !prefs.data?.workspaceRightCollapsed : drawer === "right";
  const noteList = useMemo(() => notes.data ?? [], [notes.data]);
  const docList = useMemo(() => documents.data ?? [], [documents.data]);
  const ws = tabState.sessionKey === sessionKey ? tabState.ws : EMPTY;
  const splitAvailable = isDesktop && mainWidth >= SPLIT_MIN_WIDTH;
  const view = panes(ws, splitAvailable);
  const activeId = ws.active?.kind === "note" ? ws.active.id : null;
  const openIds = ws.tabs.filter((t) => t.kind === "note").map((t) => t.id);
  const act = useCallback((a: TabAction) => setTabState((t) => ({ ...t, ws: reduceTabs(t.ws, a) })), []);

  // ---- workspace state per session (FR-013, 007 FR-013/FR-014a) -------------------------
  useEffect(() => {
    let live = true;
    // `?note=<id>` (e.g. "Open note" after a transcription) also opens and selects that note
    const withLinked = (s: TabsState) => (linkedNote ? reduceTabs(s, { type: "open", tab: { kind: "note", id: linkedNote } }) : s);
    fetchWorkspace(sessionKey).then(
      (s) => live && setTabState({ ws: withLinked(fromServer(s)), sessionKey }),
      () => live && setTabState({ ws: withLinked(EMPTY), sessionKey }),
    );
    return () => {
      live = false;
    };
  }, [sessionKey, linkedNote]);

  // debounced save of the tab state; a pending save is sent at once when the session changes
  // or the workspace unmounts, so switching quickly never loses tabs (US3 #3)
  const pendingTabs = useRef<{ key: string; ws: TabsState } | null>(null);
  const sendPendingTabs = useCallback(() => {
    const p = pendingTabs.current;
    pendingTabs.current = null;
    if (p) void putWorkspace(p.key, toServer(p.ws)).catch(() => {});
  }, []);
  useEffect(() => {
    if (tabState.sessionKey !== sessionKey) return;
    pendingTabs.current = { key: sessionKey, ws: tabState.ws };
    const t = window.setTimeout(sendPendingTabs, 500);
    return () => window.clearTimeout(t);
  }, [tabState, sessionKey, sendPendingTabs]);
  useEffect(() => sendPendingTabs, [sessionKey, sendPendingTabs]);

  // transcripts appended by the server appear in the open editor without reload (004 FR-009)
  useEffect(() => onServerAppend((noteId, text) => eachEditor((e) => e.appendContent(noteId, text))), [eachEditor]);
  // a note replaced by an import shows its new content (006 FR-020)
  useEffect(() => onServerReplace((noteId, text) => eachEditor((e) => e.replaceContent(noteId, text))), [eachEditor]);

  // ---- tab actions -----------------------------------------------------------------------
  const openNote = useCallback((id: string) => act({ type: "open", tab: { kind: "note", id } }), [act]);
  const openDocument = useCallback((id: string) => act({ type: "open", tab: { kind: "document", id } }), [act]);
  const closeDeletedDocument = useCallback((id: string) => act({ type: "close", tab: { kind: "document", id } }), [act]);

  const closeTab = useCallback(
    (tab: TabRef) => {
      if (tab.kind === "note") {
        void getSaver(tab.id)?.flush();
        eachEditor((e) => e.forget(tab.id));
        act({ type: "close", tab });
        return;
      }
      // unsent annotation changes: try now, else ask (007 FR-029)
      void confirmCloseDocument(tab.id).then((go) => go && act({ type: "close", tab }));
    },
    [act, eachEditor],
  );

  const togglePanel = useCallback(
    (side: "left" | "right") => {
      if (!isDesktop) return setDrawer((d) => (d === side ? null : side));
      if (side === "left") {
        // the app's left panel is hidden: bring it back with the sections open; else collapse
        // the workspace's sections together (or expand them all when all are collapsed)
        if (!sidePanel.panelVisible) {
          sidePanel.showPanel();
          sidePanel.setCollapsed(leftIds, false);
        } else sidePanel.setCollapsed(leftIds, !leftCollapsed);
        return;
      }
      updatePrefs.mutate({ workspaceRightCollapsed: !(prefs.data?.workspaceRightCollapsed ?? false) });
    },
    [isDesktop, prefs.data, updatePrefs, sidePanel, leftIds, leftCollapsed],
  );

  const toggleMode = useCallback(
    () => updatePrefs.mutate({ editorMode: mode === "live" ? "raw" : "live" }),
    [mode, updatePrefs],
  );

  const noteImporter = useNoteImporter({ sessionKey, notes: noteList, onOpen: openNote });

  useWorkspaceKeyboard({
    newNote: () => setDialog({ kind: "new" }),
    importNote: noteImporter.pick,
    closeTab: () => ws.active && closeTab(ws.active),
    nextTab: () => act({ type: "cycle", dir: 1 }),
    prevTab: () => act({ type: "cycle", dir: -1 }),
    toggleLeft: () => togglePanel("left"),
    toggleRight: () => togglePanel("right"),
    toggleSplit: () => splitAvailable && act({ type: "toggleSplit" }),
  });

  // ---- tab names ----------------------------------------------------------------------------
  const noteById = useMemo(() => new Map(noteList.map((n) => [n.id, n])), [noteList]);
  const docById = useMemo(() => new Map(docList.map((d) => [d.id, d])), [docList]);
  const titleOf = useCallback(
    (t: TabRef) => (t.kind === "note" ? noteById.get(t.id)?.name : docById.get(t.id)?.name),
    [noteById, docById],
  );

  // ---- note editors per pane ----------------------------------------------------------------
  // A pane showing a document keeps its last note's editor mounted but hidden, so undo history and
  // scroll survive; it is dropped when that note is closed or shown in the other pane.
  const [held, setHeld] = useState<Record<Side, string | null>>({ left: null, right: null });
  const editorNote = (side: Side): string | null => {
    const shown = side === "left" ? view.left : view.right;
    if (shown?.kind === "note") return shown.id;
    if (side === "right" && !view.split) return null;
    const h = held[side];
    if (!h || !openIds.includes(h)) return null;
    const o = side === "left" ? view.right : view.left;
    return o?.kind === "note" && o.id === h ? null : h;
  };
  const leftNote = editorNote("left");
  const rightNote = editorNote("right");
  if (held.left !== leftNote || held.right !== rightNote) setHeld({ left: leftNote, right: rightNote });
  useEffect(() => {
    // an editor's cached state for a note now edited in the other pane is stale
    if (leftNote) rightEditor.current?.forget(leftNote);
    if (rightNote) leftEditor.current?.forget(rightNote);
  }, [leftNote, rightNote]);

  // ---- active note + conflicts ------------------------------------------------------------
  const activeMeta = activeId ? noteById.get(activeId) : undefined;
  const activeSaver = activeId ? getSaver(activeId) : undefined;
  const activeSnap = useSaveStatus(activeSaver);
  const editorOf = (noteId: string) => (leftNote === noteId ? leftEditor.current : rightNote === noteId ? rightEditor.current : null);

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
    eachEditor((e) => e.replaceContent(activeSaver.noteId, text));
    openNote(created.id);
    toast.success(`Your text was saved as “${created.name}”.`);
  };

  const useTheirs = () => {
    if (!activeSaver) return;
    const text = activeSaver.useTheirs();
    eachEditor((e) => e.replaceContent(activeSaver.noteId, text));
  };

  // ---- document readers: one per open document tab, kept mounted (research R11) ------------
  const parking = useRef<HTMLDivElement>(null);
  const [hosts] = useState(() => new Map<string, HTMLDivElement>());
  const openDocIds = ws.tabs.filter((t) => t.kind === "document" && docById.has(t.id)).map((t) => t.id);
  const hostFor = (id: string) => {
    let h = hosts.get(id);
    if (!h) {
      h = document.createElement("div");
      h.className = "h-full min-h-0";
      h.dataset.docHost = id;
      hosts.set(id, h);
    }
    return h;
  };
  useEffect(() => {
    for (const [id, h] of hosts)
      if (!openDocIds.includes(id)) {
        h.remove();
        hosts.delete(id);
      }
  });

  // ---- layout -----------------------------------------------------------------------------
  const leftContent: Record<string, ReactNode> = {
    notes: (
      <NoteList
        notes={noteList}
        openIds={openIds}
        activeId={activeId}
        loading={notes.isPending}
        onNew={() => setDialog({ kind: "new" })}
        onImport={noteImporter.pick}
        importing={noteImporter.running}
        onOpen={openNote}
        onRename={(note) => setDialog({ kind: "rename", note })}
        onDelete={(note) => {
          setDeleteError(undefined);
          setDialog({ kind: "delete", note });
        }}
      />
    ),
    ...Object.fromEntries(
      sideSections.map(({ id, component: Section }) => [
        id,
        <Section key={id} sessionKey={sessionKey} openDocument={openDocument} closeDocument={closeDeletedDocument} />,
      ]),
    ),
    sessions: (
      <nav aria-label="Sessions of this course" className="py-1">
        {timeline.data && <SessionTimeline entries={timeline.data.entries} variant="compact" activeKey={sessionKey} />}
      </nav>
    ),
  };
  const leftBody = (id: string) => <div className="py-2">{leftContent[id]}</div>;
  // mobile drawer: the same collapsible sections, stacked and scrolling together
  const left = (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {leftSections.map(({ id, title }, i) => (
        <CollapsibleSection
          key={id}
          id={id}
          title={title}
          collapsed={sidePanel.collapsed[id] ?? false}
          onToggle={() => sidePanel.setCollapsed([id], !sidePanel.collapsed[id])}
          className={cn("shrink-0", i > 0 && "border-t border-divider")}
        >
          {leftBody(id)}
        </CollapsibleSection>
      ))}
    </div>
  );

  const emptyPane = (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="grid max-w-sm gap-3">
        <p className="text-sm text-muted-foreground">
          {noteList.length || docList.length ? "Choose a note or document on the left, or start a new note." : "No notes for this session yet."}
        </p>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => setDialog({ kind: "new" })} className="text-sm font-medium text-primary underline underline-offset-4">
            New note <kbd className="ml-1 font-mono text-xs text-muted-foreground">Alt+N</kbd>
          </button>
          <button type="button" onClick={noteImporter.pick} className="text-sm font-medium text-primary underline underline-offset-4">
            Import note <kbd className="ml-1 font-mono text-xs text-muted-foreground">Alt+Shift+N</kbd>
          </button>
        </div>
      </div>
    </div>
  );

  const pane = (side: Side) => {
    const shown = side === "left" ? view.left : view.right;
    const known = shown && titleOf(shown) !== undefined ? shown : null;
    const noteId = side === "left" ? leftNote : rightNote;
    const focused = view.split && ws.split?.focused === side;
    return (
      <section
        id={paneId(side)}
        role="tabpanel"
        aria-labelledby={known ? tabDomId(known) : undefined}
        aria-label={known ? undefined : side === "left" ? "Left pane" : "Right pane"}
        onFocusCapture={() => view.split && !focused && act({ type: "focusPane", side })}
        onPointerDownCapture={() => view.split && !focused && act({ type: "focusPane", side })}
        className={cn("relative h-full min-h-0 min-w-0 bg-editor-surface", view.split && focused && "shadow-[inset_0_2px_0_var(--accent)]")}
      >
        {noteId && (
          <NotePane
            noteId={noteId}
            meta={noteById.get(noteId)}
            visible={known?.kind === "note"}
            mode={mode}
            editorRef={editors[side]}
            onToggleMode={toggleMode}
          />
        )}
        {known?.kind === "document" && <DocSlot host={hostFor(known.id)} parking={parking} />}
        {!known && (side === "left" || !view.split ? emptyPane : <p className="grid h-full place-items-center p-8 text-sm text-muted-foreground">Select a tab to show it here.</p>)}
      </section>
    );
  };

  const ratio = ws.split?.ratio ?? 0.5;
  const showsNote = view.left?.kind === "note" || view.right?.kind === "note";
  const editorArea = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-end justify-between gap-2 bg-surface">
        <WorkspaceTabs
          state={ws}
          titleOf={titleOf}
          splitAvailable={splitAvailable}
          onSelect={(tab) => act({ type: "open", tab })}
          onClose={closeTab}
          onToggleSplit={() => act({ type: "toggleSplit" })}
          onMoveToOtherPane={(tab) => act({ type: "moveToOtherPane", tab })}
        />
        {showsNote && (
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
        )}
      </div>
      <div
        ref={panesRef}
        className="grid min-h-0 flex-1"
        style={{ "--split-l": `${ratio * 100}%`, gridTemplateColumns: view.split ? "minmax(0,var(--split-l)) minmax(0,1fr)" : "minmax(0,1fr)" } as CSSProperties}
      >
        {pane("left")}
        {view.split && (
          <div className="relative min-h-0 min-w-0 border-l border-divider">
            <PanelResizeHandle
              value={Math.round(ratio * 100)}
              min={20}
              max={80}
              defaultValue={50}
              step={2}
              unitsPerPx={() => 100 / (panesRef.current?.clientWidth || 1)}
              onResize={(v) => act({ type: "setRatio", ratio: v / 100 })}
              onDrag={(v) => panesRef.current?.style.setProperty("--split-l", `${v}%`)}
              grow="right"
              label="Resize split view"
              controls={paneId("left")}
              className="left-0"
            />
            {pane("right")}
          </div>
        )}
      </div>
      <div ref={parking} hidden />
      {openDocIds.map((id) =>
        createPortal(
          <DocumentTabView
            documentId={id}
            visible={same(view.left, { kind: "document", id }) || same(view.right, { kind: "document", id })}
            onEscape={() => document.getElementById(tabDomId({ kind: "document", id }))?.focus()}
          />,
          hostFor(id),
          id,
        ),
      )}
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <WorkspaceHeader
        courseId={courseId}
        session={session.data}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={isDesktop ? undefined : () => togglePanel("left")}
        onToggleRight={() => togglePanel("right")}
      />
      {session.isError ? (
        <p role="alert" className="p-8 text-sm text-danger">This session doesn't exist.</p>
      ) : (
        <AudioColumns
          desktop={isDesktop}
          rightOpen={rightOpen}
          panel={
            <aside id="workspace-audio-panel" aria-label="Audio" className="h-full min-h-0 overflow-x-hidden overflow-y-auto border-l border-divider bg-surface">
              <RightPanel sessionKey={sessionKey} />
            </aside>
          }
        >
          {isDesktop &&
            leftSections.map(({ id }) => {
              const target = sidePanel.targets[id];
              return target ? createPortal(leftBody(id), target, id) : null;
            })}
          <main ref={mainRef} className="min-h-0 min-w-0" aria-label="Notes and documents">{editorArea}</main>
        </AudioColumns>
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

      {noteImporter.element}
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
            requestAnimationFrame(() => requestAnimationFrame(() => editorOf(note.id)?.focus()));
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
            closeTab({ kind: "note", id: note.id });
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
