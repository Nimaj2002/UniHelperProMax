/**
 * A session's (or event's) tracked time, with "Start timer" linked to it (020 US11, FR-056,
 * FR-057). A dialog opened from the session panel's clock button or rail item; the timer gets the
 * course's tag (the tag of the course's name the server keeps for every current course).
 */
import { Play, Stop } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEntries, useTags, useTimer, useTimerActions } from "./api";
import { formatDuration } from "./clock";
import { TagLabel } from "./TagPicker";

const DAY = 86_400_000;

interface Props {
  sessionKey: string;
  courseName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The time card's content: total, timer and course tag. Shown in the dialog (Ultimate) or the main area (Simple). */
export function SessionTimeBody({ sessionKey, courseName, active = true, titleAs: Title = "h2" }: { sessionKey: string; courseName?: string | null; active?: boolean; titleAs?: React.ElementType }) {
  // a session's study time can be logged long after it; the API allows up to 400 days at once
  const [now] = useState(() => Math.floor(Date.now() / DAY) * DAY);
  const entries = useEntries(new Date(now - 398 * DAY).toISOString(), new Date(now + 2 * DAY).toISOString(), sessionKey, active);
  const timer = useTimer().data ?? null;
  const actions = useTimerActions();
  const name = courseName?.trim().toLowerCase();
  const tag = (useTags().data ?? []).find((t) => !!name && t.name.trim().toLowerCase() === name) ?? null;
  const total = (entries.data ?? []).reduce((s, e) => s + e.durationSeconds, 0);
  const running = timer?.sessionKey === sessionKey;
  return (
    <>
      <div className="grid gap-1.5">
        <Title className="text-lg font-semibold">Time</Title>
        <p className="text-sm text-muted-foreground">
          Time tracked: <span className="tabular-nums">{formatDuration(total)}</span>
          {running && " · timer running"}
        </p>
      </div>
      {tag && <TagLabel tag={tag} className="text-sm" />}
      {running ? (
        <Button size="sm" variant="outline" className="h-8 gap-1.5 self-start" onClick={() => void actions.stop()}>
          <Stop size={14} aria-hidden /> Stop timer
        </Button>
      ) : (
        <Button size="sm" className="h-8 gap-1.5 self-start" onClick={() => void actions.start({ style: "track", sessionKey, tagId: tag?.id ?? null })}>
          <Play size={14} aria-hidden /> Start timer
        </Button>
      )}
    </>
  );
}

export function SessionTimeDialog({ sessionKey, courseName, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="sr-only">
          <DialogTitle>Time</DialogTitle>
          <DialogDescription>Time tracked and timer for this session</DialogDescription>
        </DialogHeader>
        <SessionTimeBody sessionKey={sessionKey} courseName={courseName} active={open} titleAs="p" />
      </DialogContent>
    </Dialog>
  );
}
