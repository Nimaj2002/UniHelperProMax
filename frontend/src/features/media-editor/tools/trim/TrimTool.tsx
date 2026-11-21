import { Scissors, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePeaks, useTrim, type Peaks } from "../../api";
import { useEditor } from "../../session";
import { registerTool, type ToolProps } from "../../tools";
import { SaveDialog } from "./SaveDialog";
import { TimeField } from "./TimeFields";
import { formatTime } from "./time";
import { Waveform } from "./Waveform";
import { clampEnd, clampStart, isUntouched, type Range } from "./windows";

/** Trim (025 US1): choose the part to keep, preview it, save as new or over the original. */
export function TrimTool({ recording, sessionKey }: ToolProps) {
  const peaks = usePeaks(recording.id);
  if (peaks.isPending || peaks.isRefetching) return <TrimSkeleton />;
  if (peaks.isError)
    return (
      <div role="alert" className="grid gap-2 p-4 text-sm">
        <p className="font-medium text-danger">This audio can't be opened for editing.</p>
        <p className="text-muted-foreground">The file may be missing or in a format that can't be read. Nothing was changed.</p>
        <div>
          <Button variant="outline" size="sm" onClick={() => void peaks.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  return <TrimBody recording={recording} sessionKey={sessionKey} peaks={peaks.data} />;
}

/** The tool's shape while the waveform loads: waveform box, play controls, time fields. */
function TrimSkeleton() {
  const bar = "animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none";
  return (
    <div role="status" aria-busy="true" className="grid gap-4 p-4">
      <span className="sr-only">Loading the waveform…</span>
      <div aria-hidden className={`h-32 w-full border border-divider ${bar}`} />
      <div aria-hidden className="flex items-center gap-2">
        <div className={`h-8 w-20 ${bar}`} />
        <div className={`h-8 w-36 ${bar}`} />
        <div className={`ml-1 h-4 w-28 ${bar}`} />
      </div>
      <div aria-hidden className="flex flex-wrap items-end gap-4">
        <div className={`h-9 w-36 ${bar}`} />
        <div className={`h-9 w-36 ${bar}`} />
        <div className={`ml-auto h-9 w-24 ${bar}`} />
      </div>
    </div>
  );
}

function TrimBody({ recording, sessionKey, peaks }: ToolProps & { peaks: Peaks }) {
  const { setDirty } = useEditor();
  const trim = useTrim();
  const duration = peaks.durationMs;
  // a new audio (or a new version after an overwrite) mounts this fresh, with everything selected
  const [ranges, setRanges] = useState<Range[]>([{ startMs: 0, endMs: duration }]);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const many = ranges.length > 1;
  const current = ranges[Math.min(active, ranges.length - 1)];
  const idx = ranges.indexOf(current);
  const dirty = !isUntouched(ranges, duration);
  const problem = dirty ? null : "Nothing to trim yet: the whole audio is selected.";
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  const change = (next: Range[], activeIndex?: number) => {
    setRanges(next);
    if (activeIndex !== undefined) setActive(activeIndex);
  };
  const edit = (edge: "startMs" | "endMs", ms: number) => {
    const applied = edge === "startMs" ? clampStart(ranges, idx, ms) : clampEnd(ranges, idx, ms, duration);
    change(ranges.map((r, k) => (k === idx ? { ...r, [edge]: applied } : r)));
    return applied;
  };
  const remove = (i: number) => {
    change(ranges.filter((_, k) => k !== i), Math.max(0, Math.min(active, ranges.length - 2)));
  };

  return (
    <div className="grid gap-4 p-4">
      <Waveform recording={recording} peaks={peaks} ranges={ranges} active={idx} onChange={change} onActive={setActive} />
      {many && (
        <ul aria-label="Windows" className="flex flex-wrap gap-2">
          {ranges.map((r, i) => (
            <li key={i} className={`flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-xs ${i === idx ? "border-primary bg-accent" : "border-divider"}`}>
              <button type="button" className="font-mono tabular-nums" aria-pressed={i === idx} onClick={() => setActive(i)}>
                <span className="font-sans font-semibold">Window {i + 1}</span> {formatTime(r.startMs)}–{formatTime(r.endMs)}
              </button>
              <Button type="button" variant="ghost" size="icon" className="size-6" aria-label={`Remove window ${i + 1}`} onClick={() => remove(i)}>
                <X size={12} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <TimeField label={many ? `Window ${idx + 1} start` : "Start"} valueMs={current.startMs} maxMs={duration} onChange={(ms) => edit("startMs", ms)} />
        <TimeField label={many ? `Window ${idx + 1} end` : "End"} valueMs={current.endMs} maxMs={duration} onChange={(ms) => edit("endMs", ms)} />
        <div className="ml-auto flex items-end gap-2 self-end">
          <Button variant="ghost" onClick={() => change([{ startMs: 0, endMs: duration }], 0)} disabled={!dirty}>
            Reset
          </Button>
          <Button onClick={() => setSaving(true)} disabled={!!problem || trim.isPending}>
            <Scissors size={16} aria-hidden />
            Save…
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {problem ?? "The framed parts are kept. The dimmed parts are cut. Drag the pins, a frame's top strip, or use the time fields."}
      </p>
      {saving && (
        <SaveDialog
          recording={recording}
          windows={ranges}
          onClose={() => setSaving(false)}
          onSave={async ({ mode, name, combine }) => {
            const result = await trim.mutateAsync({
              recordingId: recording.id,
              sessionKey,
              version: recording.version,
              ranges,
              mode,
              name,
              combine,
            });
            setSaving(false);
            setDirty(false);
            const n = result.recordings.length;
            toast.success(
              mode === "new"
                ? n > 1
                  ? `Saved ${n} recordings.`
                  : `Saved “${result.recording.name}”.`
                : `Trimmed “${result.recording.name}”.`,
              mode === "overwrite" ? { description: "The old audio is in Settings → Trash." } : undefined,
            );
            return result;
          }}
        />
      )}
    </div>
  );
}

registerTool({ id: "trim", title: "Trim", icon: Scissors, component: TrimTool, priority: 0 });
