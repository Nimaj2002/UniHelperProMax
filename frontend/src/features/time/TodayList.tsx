/**
 * Today (020 US2): the day's entries in time order with durations and the day's total (the running
 * timer counted live), Edit, Delete with Undo and "Start again". P3: daily goal progress and the
 * number of Pomodoro work periods done today.
 */
import { DotsThree, PencilSimple, Play, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { useMe } from "@/features/auth/api";
import { todayISO } from "@/lib/dates";
import { clockOffset, useDeleteEntry, useEntries, useTags, useTimer, useTimerActions, type Entry } from "./api";
import { elapsedMs, formatDuration } from "./clock";
import { clippedSeconds, dayBounds, rangeOf, timeOfDay } from "./days";
import { EntryForm } from "./EntryForm";
import { onEntryEdit, takeEntryEdit } from "./openTime";
import { useTimePrefs } from "./prefs";
import { TagLabel } from "./TagPicker";
import { useTick } from "./useTick";

export function TodayList() {
  const tz = useMe().data?.timezone ?? "UTC";
  const today = todayISO(tz);
  const { from, to } = rangeOf(today, today, tz);
  const entries = useEntries(from, to);
  const tags = useTags().data ?? [];
  const timer = useTimer().data ?? null;
  const prefs = useTimePrefs();
  const actions = useTimerActions();
  const remove = useDeleteEntry();
  const now = useTick(!!timer && timer.state === "running");
  const [editing, setEditing] = useState<Entry | null>(takeEntryEdit);
  useEffect(() => onEntryEdit(() => setEditing(takeEntryEdit())), []);

  const { start, end } = dayBounds(today, tz);
  const list = useMemo(() => [...(entries.data ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt)), [entries.data]);
  const saved = list.reduce((sum, e) => sum + clippedSeconds(e, start, end), 0);
  const live = timer && timer.state !== "waiting" && (timer.style === "track" || timer.phase === "work" || timer.style === "focus") ? elapsedMs(timer, now, clockOffset()) / 1000 : 0;
  const total = saved + live;
  const pomodoros = list.filter((e) => e.source === "pomodoro").length;
  const tagOf = (id: string | null | undefined) => tags.find((t) => t.id === id) ?? null;
  const goal = prefs.dailyGoalMin;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-sm font-semibold">Today</h3>
        <span className="text-sm tabular-nums" aria-label={`Today's total: ${formatDuration(total)}`}>
          {formatDuration(total)}
        </span>
      </div>
      {goal && (
        <div className="flex flex-col gap-1 px-1">
          <Progress value={Math.min(100, (total / (goal * 60)) * 100)} aria-label={`Daily goal: ${formatDuration(total)} of ${formatDuration(goal * 60)}`} />
          <span className="text-xs text-text-muted">
            {formatDuration(total)} of {formatDuration(goal * 60)} goal
          </span>
        </div>
      )}
      {pomodoros > 0 && <p className="px-1 text-xs text-text-muted">{pomodoros} Pomodoro{pomodoros === 1 ? "" : "s"} today</p>}
      {entries.isError && (
        <p role="alert" className="px-1 text-xs text-danger">
          Couldn't load today's entries.
        </p>
      )}
      {list.length === 0 && !entries.isPending ? (
        <p className="px-1 text-xs text-text-muted">No time tracked today yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider" aria-label="Today's entries">
          {list.map((e) => (
            <li key={e.id} className="flex min-w-0 items-center gap-2 px-1 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{e.description || e.linkTitle || "(no description)"}</p>
                <p className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
                  <span className="shrink-0 tabular-nums">
                    {timeOfDay(Date.parse(e.startedAt), tz)}–{timeOfDay(Date.parse(e.endedAt), tz)}
                  </span>
                  {e.tagId && <TagLabel tag={tagOf(e.tagId)} />}
                </p>
              </div>
              <span className="shrink-0 text-xs tabular-nums">{formatDuration(e.durationSeconds)}</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label={`Start again: ${e.description || "entry"}`}
                title="Start again"
                onClick={() => void actions.start({ style: "track", description: e.description, tagId: e.tagId, taskId: e.taskId, sessionKey: e.sessionKey, courseId: e.taskId || e.sessionKey ? null : e.courseId })}
              >
                <Play size={14} aria-hidden />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`More for ${e.description || "entry"}`}>
                    <DotsThree size={16} aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(e)}>
                    <PencilSimple size={14} aria-hidden /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate(e)}>
                    <Trash size={14} aria-hidden /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      {editing && <EntryForm key={editing.id} entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
