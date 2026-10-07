import { ArrowArcLeft, ArrowArcRight, Pause, Play, SpeakerHigh, SpeakerSlash, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { usePreferences, useUpdatePreferences } from "@/features/sessions/api";
import { audioUrl, type Recording } from "./api";
import { formatDuration } from "./format";
import { claimPlayback, releasePlayback } from "./nowPlaying";

const SKIP = 5;

/** Play/pause, stop, seek, ±5 s, volume + mute (FR-017–FR-022). */
/** Why playback failed, in words. A browser may not decode a valid imported format (006). */
export function playbackError(recording: Recording, err: MediaError | null): string {
  if (recording.missing) return "The audio file is missing from the session folder.";
  if (recording.origin === "imported" && err?.code === 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */) {
    const format = recording.fileName.slice(recording.fileName.lastIndexOf(".") + 1).toUpperCase();
    return `This browser can't play ${format} files. Try another browser, or transcribe it.`;
  }
  return "This recording can't be played.";
}

export function Player({ recording }: { recording: Recording }) {
  const audio = useRef<HTMLAudioElement>(null);
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const volume = prefs.data?.playerVolume ?? 1;
  const muted = prefs.data?.playerMuted ?? false;
  const duration = mediaDuration && Number.isFinite(mediaDuration) ? mediaDuration : recording.durationMs / 1000;

  useEffect(() => {
    if (audio.current) {
      audio.current.volume = volume;
      audio.current.muted = muted;
    }
  }, [volume, muted]);

  useEffect(() => {
    const el = audio.current;
    return () => {
      if (el) {
        el.pause();
        releasePlayback(el);
      }
    };
  }, []);

  const seek = (t: number) => {
    const el = audio.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(duration || el.duration || 0, t));
    el.currentTime = clamped;
    setTime(clamped);
  };

  const toggle = async () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      claimPlayback(el);
      try {
        await el.play();
      } catch {
        setError("This recording can't be played in this browser.");
      }
    } else el.pause();
  };

  const stop = () => {
    audio.current?.pause();
    seek(0);
  };

  const setVolume = (v: number) => updatePrefs.mutate({ playerVolume: Math.round(Math.max(0, Math.min(1, v)) * 100) / 100, playerMuted: false });

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[role='slider']") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") {
      if (target.tagName === "BUTTON" && k === " ") return;
      e.preventDefault();
      void toggle();
    } else if (k === "j" || e.key === "ArrowLeft") {
      e.preventDefault();
      seek(time - SKIP);
    } else if (k === "l" || e.key === "ArrowRight") {
      e.preventDefault();
      seek(time + SKIP);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setVolume(volume + 0.1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setVolume(volume - 0.1);
    } else if (k === "m") {
      e.preventDefault();
      updatePrefs.mutate({ playerMuted: !muted });
    }
  };

  return (
    // the player is a keyboard-operable group (ui-recording.md key map)
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div role="group" aria-label={`Player: ${recording.name}`} onKeyDown={onKey} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-divider bg-surface-elevated p-3">
      {/* user-recorded lecture audio has no caption track; its text alternative is the
          transcript produced by feature 004 */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audio}
        src={audioUrl(recording.id, recording.version)}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setMediaDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setMediaDuration(e.currentTarget.duration)}
        onError={(e) => setError(playbackError(recording, e.currentTarget.error))}
      />
      <p className="truncate text-sm font-medium" title={recording.name}>{recording.name}</p>
      {/* transport and volume wrap onto two lines when the panel is narrow */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" aria-label={playing ? "Pause" : "Play"} aria-keyshortcuts="Space K" onClick={() => void toggle()}>
            {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
          </Button>
          <Button size="icon" variant="ghost" aria-label="Stop" onClick={stop}>
            <Stop size={18} weight="fill" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Back 5 seconds" aria-keyshortcuts="J ArrowLeft" onClick={() => seek(time - SKIP)}>
            <ArrowArcLeft size={18} />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Forward 5 seconds" aria-keyshortcuts="L ArrowRight" onClick={() => seek(time + SKIP)}>
            <ArrowArcRight size={18} />
          </Button>
        </div>
        <div className="flex min-w-32 flex-1 items-center gap-1">
          <Button size="icon" variant="ghost" className="shrink-0" aria-label={muted ? "Unmute" : "Mute"} aria-keyshortcuts="M" onClick={() => updatePrefs.mutate({ playerMuted: !muted })}>
            {muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
          </Button>
          <Slider
            className="min-w-0 flex-1"
            aria-label="Volume"
            min={0}
            max={100}
            step={5}
            value={[Math.round((muted ? 0 : volume) * 100)]}
            onValueChange={([v]) => setVolume(v / 100)}
          />
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
        <span className="shrink-0">{formatDuration(time * 1000)}</span>
        <Slider
          className="min-w-0 flex-1"
          aria-label="Seek"
          aria-valuetext={`${formatDuration(time * 1000)} of ${formatDuration(duration * 1000)}`}
          min={0}
          max={Math.max(duration, 0.1)}
          step={1}
          value={[Math.min(time, duration)]}
          onValueChange={([v]) => seek(v)}
          onKeyDown={(e) => {
            const d: Record<string, number> = { ArrowLeft: -SKIP, ArrowDown: -SKIP, ArrowRight: SKIP, ArrowUp: SKIP, PageDown: -60, PageUp: 60 };
            if (e.key in d) {
              e.preventDefault();
              seek(time + d[e.key]);
            }
          }}
        />
        <span className="shrink-0">{formatDuration(duration * 1000)}</span>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
