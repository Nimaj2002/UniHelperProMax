import { Pause, Play, Plus, Repeat } from "@phosphor-icons/react";
import { useWavesurfer } from "@wavesurfer/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import { Button } from "@/components/ui/button";
import { audioUrl } from "@/features/recordings/api";
import { formatDuration } from "@/features/recordings/format";
import { cn } from "@/lib/utils";
import type { MediaRecording, Peaks } from "../../api";
import { formatTime, MIN_RANGE_MS } from "./time";
import { addWindowAt, clampEnd, clampStart, gaps, moveWindow, type Range } from "./windows";

interface Props {
  recording: MediaRecording;
  peaks: Peaks;
  /** The keep-windows, sorted and never overlapping (`windows.ts`). */
  ranges: Range[];
  active: number;
  onChange: (ranges: Range[], active?: number) => void;
  onActive: (index: number) => void;
}

/** A theme colour token as the canvas needs it (resolved), re-read when the theme changes. */
function useToken(name: string): string {
  const read = () => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "currentColor";
  const [value, setValue] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setValue(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return value;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pct = (ms: number, total: number) => `${(clamp(ms, 0, total) / total) * 100}%`;
/** ←/→ step: 0.1 s; Shift 1 s; Alt 10 s. */
const stepOf = (e: KeyboardEvent) => (e.altKey ? 10_000 : e.shiftKey ? 1000 : 100);

/** Pointer dragging that reports the pointer's position as milliseconds along the waveform. */
function makeDrag(total: number) {
  const toMs = (area: HTMLElement | null | undefined, clientX: number) => {
    const r = area?.getBoundingClientRect();
    return r && r.width ? clamp(((clientX - r.left) / r.width) * total, 0, total) : 0;
  };
  return (onMove: (ms: number, fromMs: number) => void) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const area = el.closest<HTMLElement>("[data-wave-area]");
    el.setPointerCapture(e.pointerId);
    const from = toMs(area, e.clientX);
    const move = (ev: globalThis.PointerEvent) => onMove(toMs(area, ev.clientX), from);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
}

/** A small downward triangle: the grab point of a marker. */
function Pin({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 14 9" className={cn("absolute top-0 left-1/2 h-[9px] w-3.5 -translate-x-1/2", className)}>
      <path d="M0 0h14L7 9z" fill="currentColor" />
    </svg>
  );
}

/** The cut parts: the waveform's own background laid over the bars. */
const DIM = "color-mix(in srgb, var(--surface-sunken) 82%, transparent)";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The waveform (wavesurfer.js) with the keep-windows drawn over it (025): each window is a frame
 * with grip handles and a pin on each edge, the cut parts are dimmed, and the playhead has its own
 * pin. Pins are draggable and keyboard sliders; the top strip of a frame moves the whole window.
 * Peaks come from the server, so the browser never decodes the file; playback streams the recording.
 */
export function Waveform({ recording, peaks, ranges, active, onChange, onActive }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const total = peaks.durationMs;
  const wave = useToken("--text-primary");
  const muted = useToken("--text-muted");
  const preview = useRef<{ windows: Range[]; i: number } | null>(null);
  // the playhead, updated by playback and at once by our own seeks (rapid arrow keys must add up)
  const [nowMs, setNowMs] = useState(0);

  const timeline = useMemo(
    () =>
      TimelinePlugin.create({
        height: 16,
        style: { fontSize: "11px", color: muted },
        formatTimeCallback: (s: number) => formatTime(s * 1000).replace(/\.\d+$/, ""),
      }),
    [muted],
  );
  const { wavesurfer, isPlaying } = useWavesurfer({
    container,
    url: audioUrl(recording.id, recording.version),
    peaks: [peaks.peaks],
    duration: total / 1000,
    height: 120,
    waveColor: wave,
    progressColor: wave, // the playhead shows the position; the bars stay one colour
    cursorWidth: 0,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    plugins: useMemo(() => [timeline], [timeline]),
  });

  // "Preview" plays the windows in order, skipping the cut parts, and stops after the last
  useEffect(() => {
    if (!wavesurfer) return;
    // while paused our own seeks set the position; late media events must not move it back
    const offPause = wavesurfer.on("pause", () => setNowMs(wavesurfer.getCurrentTime() * 1000));
    const offTime = wavesurfer.on("timeupdate", (t: number) => {
      if (wavesurfer.isPlaying()) setNowMs(t * 1000);
      const p = preview.current;
      if (!p || t * 1000 < p.windows[p.i].endMs) return;
      const next = p.windows[p.i + 1];
      if (next) {
        p.i += 1;
        wavesurfer.setTime(next.startMs / 1000);
      } else {
        preview.current = null;
        wavesurfer.pause();
      }
    });
    return () => {
      offPause();
      offTime();
    };
  }, [wavesurfer]);

  const seek = (ms: number) => {
    const at = clamp(ms, 0, total);
    setNowMs(at);
    wavesurfer?.setTime(at / 1000);
  };
  const drag = makeDrag(total);
  const grabbed = useRef(ranges);
  const many = ranges.length > 1;
  const nameOf = (i: number, edge: "start" | "end") => (many ? `Window ${i + 1} ${edge}` : `Selection ${edge}`);

  const key = (e: KeyboardEvent, at: number, set: (ms: number) => void) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    set(at + (e.key === "ArrowRight" ? 1 : -1) * stepOf(e));
  };
  const setStart = (i: number, ms: number) =>
    onChange(ranges.map((r, k) => (k === i ? { ...r, startMs: clampStart(ranges, i, ms) } : r)), i);
  const setEnd = (i: number, ms: number) =>
    onChange(ranges.map((r, k) => (k === i ? { ...r, endMs: clampEnd(ranges, i, ms, total) } : r)), i);

  const add = addWindowAt(ranges, nowMs, total);
  const addProblem = "problem" in add ? add.problem : undefined;
  const addWindow = () => {
    if (!("problem" in add)) onChange(add.ranges, add.index);
  };

  return (
    <div className="grid gap-3">
      <div
        className="relative pt-[18px]"
        role="group"
        aria-label={`Waveform of ${recording.name}, ${formatDuration(total)} long. ${
          many ? `${ranges.length} windows kept.` : `Selected from ${formatTime(ranges[0].startMs)} to ${formatTime(ranges[0].endMs)}.`
        }`}
      >
        <div data-wave-area className="relative overflow-visible rounded-md bg-surface-sunken ring-1 ring-divider">
          <div ref={container} className="isolate min-h-[136px] w-full overflow-hidden rounded-md" />

          {/* the cut parts, dimmed */}
          {gaps(ranges, total).map((g) => (
            <div
              key={g.startMs}
              aria-hidden
              className="pointer-events-none absolute inset-y-0"
              style={{ left: pct(g.startMs, total), width: `calc(${pct(g.endMs, total)} - ${pct(g.startMs, total)})`, background: DIM }}
            />
          ))}

          {ranges.map((r, i) => {
            const isActive = i === active;
            const pins = [
              { edge: "start" as const, ms: r.startMs, min: ranges[i - 1]?.endMs ?? 0, max: r.endMs - MIN_RANGE_MS, set: (ms: number) => setStart(i, ms) },
              { edge: "end" as const, ms: r.endMs, min: r.startMs + MIN_RANGE_MS, max: ranges[i + 1]?.startMs ?? total, set: (ms: number) => setEnd(i, ms) },
            ];
            return (
              <div key={i}>
                {/* the frame, and a strip along its top to move the whole window */}
                <div
                  className={cn("pointer-events-none absolute inset-y-0 border-y-4", isActive ? "border-primary" : "border-primary/60")}
                  style={{ left: pct(r.startMs, total), width: `calc(${pct(r.endMs, total)} - ${pct(r.startMs, total)})` }}
                >
                  <div
                    aria-hidden
                    title="Drag to move this window"
                    className="pointer-events-auto absolute inset-x-3 -top-1 flex h-3 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                    onPointerDown={(e) => {
                      grabbed.current = ranges;
                      onActive(i);
                      drag((ms, from) => onChange(moveWindow(grabbed.current, i, grabbed.current[i].startMs + (ms - from), total), i))(e);
                    }}
                  />
                  {many && (
                    <span aria-hidden className="absolute top-1 left-4 rounded bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                  )}
                </div>

                {pins.map((p) => (
                  <div
                    key={p.edge}
                    role="slider"
                    tabIndex={0}
                    aria-label={nameOf(i, p.edge)}
                    aria-valuemin={p.min}
                    aria-valuemax={p.max}
                    aria-valuenow={p.ms}
                    aria-valuetext={formatTime(p.ms)}
                    aria-keyshortcuts="ArrowLeft ArrowRight"
                    onFocus={() => onActive(i)}
                    onPointerDown={(e) => {
                      onActive(i);
                      drag((ms) => p.set(ms))(e);
                    }}
                    onKeyDown={(e) => key(e, p.ms, p.set)}
                    className={cn("group absolute -top-[18px] bottom-0 w-4 -translate-x-1/2 cursor-ew-resize touch-none", FOCUS)}
                    style={{ left: pct(p.ms, total) }}
                  >
                    <Pin className="text-primary" />
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-[18px] bottom-0 left-1/2 flex w-3.5 items-center justify-center bg-primary",
                        p.edge === "start" ? "-translate-x-full rounded-l-md" : "rounded-r-md",
                        !isActive && "opacity-70",
                      )}
                    >
                      <span className="h-5 w-0.5 rounded-full bg-primary-foreground/70" />
                    </span>
                  </div>
                ))}
              </div>
            );
          })}

          {/* the playhead: a line with its own pin */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.round(nowMs)}
            aria-valuetext={formatTime(nowMs)}
            aria-keyshortcuts="ArrowLeft ArrowRight"
            onPointerDown={drag((ms) => seek(ms))}
            onKeyDown={(e) => key(e, nowMs, seek)}
            className={cn("absolute -top-[18px] bottom-4 z-10 w-4 -translate-x-1/2 cursor-col-resize touch-none", FOCUS)}
            style={{ left: pct(nowMs, total) }}
          >
            <Pin className="text-[var(--now-line)]" />
            <span aria-hidden className="absolute top-[18px] bottom-0 left-1/2 w-0.5 -translate-x-1/2 bg-[var(--now-line)]" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            preview.current = null;
            void wavesurfer?.playPause();
          }}
          disabled={!wavesurfer}
        >
          {isPlaying ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          {isPlaying ? "Pause" : "Play"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (!wavesurfer) return;
            preview.current = { windows: ranges, i: 0 };
            wavesurfer.setTime(ranges[0].startMs / 1000);
            void wavesurfer.play();
          }}
          disabled={!wavesurfer}
        >
          <Repeat size={16} aria-hidden />
          {many ? "Preview windows" : "Preview selection"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={addWindow} aria-describedby="add-window-note" aria-disabled={!!addProblem} className={cn(addProblem && "opacity-60")}>
          <Plus size={16} aria-hidden />
          Add window
        </Button>
        <span className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="off">
          <span className="text-foreground">{formatTime(nowMs)}</span> / {formatTime(total)}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" /> Kept</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-surface-sunken ring-1 ring-divider" /> Cut</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-0.5 bg-[var(--now-line)]" /> Now</span>
        </span>
      </div>
      <p id="add-window-note" role="status" className="min-h-4 text-xs text-muted-foreground">
        {addProblem ?? "Add window puts a new window at the playhead."}
      </p>
    </div>
  );
}
