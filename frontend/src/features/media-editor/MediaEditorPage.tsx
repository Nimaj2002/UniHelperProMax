import { SidebarSimple } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { RIGHT_CARD_ID, useRightCard, type RightCard } from "@/app/shell/layout";
import { PageFrame } from "@/app/shell/PageFrame";
import { clampRight, RIGHT_DEFAULT } from "@/app/shell/widths";
import { Button } from "@/components/ui/button";
import { useShortcut } from "@/lib/keymap";
import { readLocal, writeLocal } from "@/lib/storage";
import { useQuery } from "@tanstack/react-query";
import { peaksQuery, useMediaTree, type MediaRecording } from "./api";
import { MediaEditorIcon } from "./open";
import { RecordingsBrowser } from "./RecordingsBrowser";
import { EditorProvider, useEditor } from "./session";
import { useTools } from "./tools";
import "./tools/trim/TrimTool"; // registers Trim, the first tool

const OPEN_KEY = "uh.mediaeditor.panel.open";
const WIDTH_KEY = "uh.mediaeditor.panel.width";

function Editor() {
  const { recordingId, requestSwitch } = useEditor();
  const [open, setOpen] = useState(() => readLocal(OPEN_KEY, true));
  const [width, setWidth] = useState(() => clampRight(readLocal(WIDTH_KEY, RIGHT_DEFAULT)));
  useEffect(() => writeLocal(OPEN_KEY, open), [open]);
  useEffect(() => writeLocal(WIDTH_KEY, width), [width]);
  const { aria } = useShortcut("workspace.toggleRight");

  // the right card holds the recordings; closed it leaves the Media Editor icon on the edge (025 FR-003)
  const card = useMemo<RightCard>(
    () => ({
      label: "Recordings",
      description: "Your recordings by class and session",
      header: (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-divider pr-1.5 pl-3">
          <MediaEditorIcon size={16} aria-hidden />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Recordings</h2>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => setOpen(false)} aria-controls={RIGHT_CARD_ID} aria-label="Close recordings" aria-keyshortcuts={aria}>
            <SidebarSimple size={18} aria-hidden className="-scale-x-100" />
          </Button>
        </div>
      ),
      body: <RecordingsBrowser currentId={recordingId} onPick={requestSwitch} />,
      open,
      setOpen,
      width,
      setWidth,
      rail: { label: "Media editor rail", reopenLabel: "Show recordings", items: [], icon: MediaEditorIcon },
    }),
    [open, width, aria, recordingId, requestSwitch],
  );
  useRightCard(card);
  const tree = useMediaTree();
  // start the waveform request now, in parallel with the recordings list (the tool reads the same query)
  useQuery({ ...peaksQuery(recordingId ?? ""), enabled: !!recordingId });
  const tools = useTools();
  const [toolId, setToolId] = useState<string | null>(null);
  const tool = tools.find((t) => t.id === toolId) ?? tools[0];

  let found: { recording: MediaRecording; sessionKey: string; sessionTitle: string; className: string } | null = null;
  for (const g of tree.data ?? [])
    for (const s of g.sessions) {
      const recording = s.recordings.find((r) => r.id === recordingId);
      if (recording) found = { recording, sessionKey: s.sessionKey, sessionTitle: s.title, className: g.name };
    }

  useEffect(() => {
    document.title = "Media editor";
  }, []);

  const bar = (
    <>
      <h1 className="truncate text-sm font-semibold">Media editor</h1>
      <div role="tablist" aria-label="Editing tools" className="ml-2 flex items-center gap-1">
        {tools.map((t) => {
          const Icon = t.icon;
          const active = t.id === tool?.id;
          return (
            <Button
              key={t.id}
              role="tab"
              aria-selected={active}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className="h-7"
              onClick={() => setToolId(t.id)}
            >
              <Icon size={14} aria-hidden />
              {t.title}
            </Button>
          );
        })}
      </div>
      <div className="flex-1" />
      {found && (
        <p className="hidden min-w-0 truncate text-xs text-muted-foreground @md:block">
          {found.className} · {found.sessionTitle}
        </p>
      )}
    </>
  );

  const Tool = tool?.component;
  return (
    <PageFrame bar={bar} className="overflow-hidden">
      <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1 overflow-y-auto" role="tabpanel" aria-label={tool?.title}>
          {found && Tool ? (
            <>
              <div className="px-4 pt-3">
                <h2 className="truncate text-base font-medium">{found.recording.name}</h2>
              </div>
              <Tool key={`${found.recording.id}:${found.recording.version}`} recording={found.recording} sessionKey={found.sessionKey} />
            </>
          ) : (
            <Empty loading={tree.isPending} missing={!!recordingId && tree.isSuccess} />
          )}
        </div>
      </div>
    </PageFrame>
  );
}

function Empty({ loading, missing }: { loading: boolean; missing: boolean }) {
  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="grid max-w-md gap-2 p-6">
      <h2 className="text-base font-medium">{missing ? "That recording isn't available" : "Choose a recording to edit"}</h2>
      <p className="text-sm text-muted-foreground">
        {missing
          ? "It may have been deleted or is still being recorded. Pick another one from the list."
          : "Pick any recording from your classes in the list. Nothing is changed until you save."}
      </p>
    </div>
  );
}

export default function MediaEditorPage() {
  return (
    <EditorProvider>
      <Editor />
    </EditorProvider>
  );
}
