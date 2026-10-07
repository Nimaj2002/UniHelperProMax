import { DotsThree, Microphone, StopCircle, WarningCircle } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSession } from "@/features/classes/api";
import { AudioDropZone } from "@/features/imports/AudioDropZone";
import { UploadAudioButton } from "@/features/imports/UploadAudioButton";
import { UploadList } from "@/features/imports/UploadList";
import { workspacePath } from "@/features/sessions/SessionTimeline";
import type { WorkspacePanelProps } from "@/features/sessions/workspace-panels";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useRecordingExtensions } from "./extensions";
import { deleteRecording, recordingsKey, renameRecording, useRecordings, type Recording } from "./api";
import { formatDuration, spokenDuration } from "./format";
import { LevelMeter } from "./LevelMeter";
import { Player } from "./Player";
import { recorder, useRecorderState, type RecorderError } from "./recorder";
import { DeleteRecordingDialog, RenameRecordingDialog } from "./RecordingDialogs";
import { usePendingUploads } from "./uploader";
import { useElapsed } from "./useElapsed";

const ERRORS: Record<RecorderError, string> = {
  permission: "Microphone access was blocked. Allow the microphone for this site in your browser's address bar or settings, then try again.",
  "no-microphone": "No microphone was found. Connect one and try again.",
  unsupported: "This browser can't record audio. Use a current version of Chrome, Edge, Firefox or Safari.",
  "in-progress": "A recording is already running in another window or tab.",
  "device-lost": "The microphone was disconnected. Everything recorded so far was kept.",
  failed: "Recording couldn't start. Check your connection and try again.",
};

function localStart(iso: string) {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${formatDay(date, "d MMM yyyy")} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Workspace right panel: record, list and play the session's recordings (US1, US4, US5). */
export function RecordingPanel({ sessionKey }: WorkspacePanelProps) {
  const rec = recorder();
  const state = useRecorderState(rec);
  const pending = usePendingUploads(rec.uploader);
  const session = useSession(sessionKey);
  const recordings = useRecordings(sessionKey);
  const qc = useQueryClient();
  const elapsed = useElapsed(state.status === "recording" ? state.startedAt : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete"; recording: Recording } | null>(null);
  const extensions = useRecordingExtensions();

  const thisSession = state.sessionKey === sessionKey && rec.active;
  const otherSession = rec.active && !thisSession;
  const list = recordings.data ?? [];
  const playable = list.find((r) => r.id === selected && r.status !== "recording");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: recordingsKey(sessionKey) });
    void qc.invalidateQueries({ queryKey: ["timeline"] });
  };

  const startRec = async () => {
    const s = session.data;
    if (!s) return;
    const label = `${s.courseName} · ${formatDay(s.date, "EEE d MMM")}`;
    if (await rec.start({ sessionKey, courseId: s.courseId, label })) refresh();
  };

  const stopRec = async () => {
    await rec.stop();
    refresh();
  };

  return (
    <AudioDropZone sessionKey={sessionKey}>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 p-4">
      <h2 className="text-sm font-semibold">Audio</h2>

      <div className="flex flex-wrap gap-2">
        {!rec.active && (
          <Button onClick={() => void startRec()} disabled={!session.data || state.status !== "idle"}>
            <Microphone size={16} weight="fill" aria-hidden /> Record
          </Button>
        )}
        <UploadAudioButton sessionKey={sessionKey} />
      </div>
      {thisSession && (
        <div className="grid gap-2 rounded-lg border border-divider bg-surface-elevated p-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
            <span className="text-sm font-medium">Recording</span>
            <span className="ml-auto font-mono text-sm tabular-nums" aria-label={`Elapsed ${spokenDuration(elapsed)}`}>
              {formatDuration(elapsed)}
            </span>
          </div>
          <span className="sr-only" aria-live="polite">{`Recording, ${spokenDuration(Math.floor(elapsed / 60000) * 60000)}`}</span>
          <LevelMeter />
          <Button variant="destructive" onClick={() => void stopRec()} disabled={state.status !== "recording"}>
            <StopCircle size={16} weight="fill" aria-hidden /> {state.status === "stopping" ? "Stopping…" : "Stop"}
          </Button>
        </div>
      )}
      {otherSession && (
        <p className="text-sm text-muted-foreground">
          Recording another session.{" "}
          {state.courseId && state.sessionKey && (
            <Link className="text-primary underline underline-offset-4" to={workspacePath(state.courseId, state.sessionKey)}>
              Go to it
            </Link>
          )}
        </p>
      )}
      {state.error && (
        <div role="alert" className="flex items-start gap-2 text-sm text-danger">
          <WarningCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{ERRORS[state.error]}</span>
        </div>
      )}
      {state.notice && !state.error && <p role="status" className="text-sm text-warning">{state.notice}</p>}

      <UploadList sessionKey={sessionKey} />

      <section aria-label="Recordings" className="grid min-w-0 gap-1">
        {recordings.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {recordings.isSuccess && list.length === 0 && !thisSession && <p className="text-sm text-muted-foreground">No recordings yet.</p>}
        <ul className="grid min-w-0 gap-1">
          {list.map((r) => {
            const live = r.status === "recording" && thisSession && state.recordingId === r.id;
            const waiting = (pending.get(r.id) ?? 0) > 0;
            return (
              <li key={r.id} className="grid gap-1">
                <div className="group flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    aria-pressed={selected === r.id}
                    disabled={r.status === "recording"}
                    className={cn(
                      "grid min-w-0 flex-1 gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent",
                      selected === r.id && "bg-accent",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className="truncate text-sm font-medium"
                        title={r.origin === "imported" && r.originalFileName ? `${r.name} — imported from ${r.originalFileName}` : r.name}
                      >
                        {r.name}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {live ? formatDuration(elapsed) : r.status === "recording" ? "—" : formatDuration(r.durationMs)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {r.origin === "imported" ? "Imported" : "Recorded"} {localStart(r.startedAt)}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {r.origin === "imported" && <Badge variant="outline">Imported</Badge>}
                      {r.status === "recording" && <Badge variant="outline">Recording</Badge>}
                      {r.status === "interrupted" && <Badge variant="outline">Recovered (interrupted)</Badge>}
                      {waiting && <Badge variant="outline">Upload pending</Badge>}
                      {r.missing && r.status !== "recording" && <Badge variant="outline">File missing</Badge>}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${r.name}`} disabled={r.status === "recording" && r.active}>
                        <DotsThree size={18} weight="bold" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDialog({ kind: "rename", recording: r })}>Rename…</DropdownMenuItem>
                      <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => setDialog({ kind: "delete", recording: r })}>
                        Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {extensions.map(({ id, Action, Details }) =>
                  Action || Details ? (
                    <div key={id} className="grid gap-1 pl-2">
                      {Action && <Action recording={r} sessionKey={sessionKey} />}
                      {Details && <Details recording={r} sessionKey={sessionKey} />}
                    </div>
                  ) : null,
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {playable && <Player key={`${playable.id}:${playable.version}`} recording={playable} />}

      {dialog?.kind === "rename" && (
        <RenameRecordingDialog
          recording={dialog.recording}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await renameRecording(dialog.recording.id, name, dialog.recording.version);
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteRecordingDialog
          recording={dialog.recording}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await deleteRecording(dialog.recording.id, dialog.recording.version);
            if (selected === dialog.recording.id) setSelected(null);
            setDialog(null);
            refresh();
            toast.success(`Deleted “${dialog.recording.name}”.`);
          }}
        />
      )}
    </div>
    </AudioDropZone>
  );
}

