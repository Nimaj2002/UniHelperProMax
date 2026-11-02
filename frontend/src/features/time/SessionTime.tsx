/**
 * A session's (or event's) tracked time on its page, with "Start timer" linked to it (020 US11,
 * FR-056, FR-057). Shown in the session panel's Recordings section.
 */
import { Play } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useEntries, useTimer, useTimerActions } from "./api";
import { formatDuration } from "./clock";

const DAY = 86_400_000;

export function SessionTime({ sessionKey }: { sessionKey: string }) {
  // a session's study time can be logged long after it; the API allows up to 400 days at once
  const [now] = useState(() => Math.floor(Date.now() / DAY) * DAY);
  const entries = useEntries(new Date(now - 398 * DAY).toISOString(), new Date(now + 2 * DAY).toISOString(), sessionKey);
  const timer = useTimer().data ?? null;
  const actions = useTimerActions();
  const total = (entries.data ?? []).reduce((s, e) => s + e.durationSeconds, 0);
  const running = timer?.sessionKey === sessionKey;
  return (
    <div className="flex items-center gap-2 px-4 pt-3 text-sm">
      <span className="min-w-0 flex-1">
        Time tracked: <span className="tabular-nums">{formatDuration(total)}</span>
        {running && <span className="text-text-muted"> · timer running</span>}
      </span>
      {!running && (
        <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => void actions.start({ style: "track", sessionKey })}>
          <Play size={14} aria-hidden /> Start timer
        </Button>
      )}
    </div>
  );
}
