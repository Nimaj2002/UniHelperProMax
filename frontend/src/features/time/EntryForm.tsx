/**
 * Add time / edit an entry (020 FR-016–FR-018): start plus an end or a duration, description, tag
 * and (P2) a course. Overlapping other entries is allowed and said (FR-017).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMe } from "@/features/auth/api";
import { useCourseOptions } from "@/features/tasks/useCourseOptions";
import { ApiError } from "@/lib/api";
import { serverNow, useCreateEntry, useEntries, usePatchEntry, type Entry } from "./api";
import { fromLocalInput, timeOfDay, toLocalInput } from "./days";
import { TagPicker } from "./TagPicker";

interface Props {
  entry?: Entry;
  onClose: () => void;
}

const NO_COURSE = "__none";

export function EntryForm({ entry, onClose }: Props) {
  const tz = useMe().data?.timezone ?? "UTC";
  const create = useCreateEntry();
  const patch = usePatchEntry();
  const courses = useCourseOptions();
  const [startValue, setStartValue] = useState(() => toLocalInput(entry ? Date.parse(entry.startedAt) : serverNow() - 3_600_000, tz));
  const [mode, setMode] = useState<"end" | "duration">("end");
  const [endValue, setEndValue] = useState(() => toLocalInput(entry ? Date.parse(entry.endedAt) : serverNow(), tz));
  const [minutes, setMinutes] = useState("60");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [tagId, setTagId] = useState<string | null>(entry?.tagId ?? null);
  const [courseId, setCourseId] = useState<string | null>(entry?.courseId ?? null);
  const [serverError, setServerError] = useState<string | null>(null);

  const start = fromLocalInput(startValue, tz);
  const end = mode === "end" ? fromLocalInput(endValue, tz) : start + Number(minutes) * 60_000;
  const error = Number.isNaN(start) || Number.isNaN(end)
    ? "Enter a start and an end."
    : mode === "duration" && !(Number(minutes) > 0)
      ? "The duration must be more than 0 minutes."
      : end <= start
        ? "The end must be after the start."
        : null;

  // FR-017: the form says when the entry overlaps others (it can still be saved)
  const day = Number.isNaN(start) ? 0 : start;
  const near = useEntries(new Date(day - 86_400_000).toISOString(), new Date(day + 2 * 86_400_000).toISOString(), undefined, !error);
  const overlaps = error ? [] : (near.data ?? []).filter((e) => e.id !== entry?.id && Date.parse(e.startedAt) < end && Date.parse(e.endedAt) > start);

  const save = () => {
    if (error) return;
    setServerError(null);
    const body = {
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(end).toISOString(),
      description,
      tagId,
      // linking a task or session sets the course on the server; otherwise this one
      ...(entry?.taskId || entry?.sessionKey ? {} : { courseId }),
    };
    const done = {
      onSuccess: () => {
        toast(entry ? "Entry saved." : "Time added.");
        onClose();
      },
      onError: (err: Error) => setServerError(err instanceof ApiError ? err.title : "Couldn't save. Check your connection and try again."),
    };
    if (entry) patch.mutate({ entry, patch: body }, done);
    else create.mutate(body, done);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit entry" : "Add time"}</DialogTitle>
          <DialogDescription>Times are in {tz}.</DialogDescription>
        </DialogHeader>
        <form id="time-entry-form" className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), save())}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="entry-start">Start</Label>
            <Input id="entry-start" type="datetime-local" value={startValue} onChange={(e) => setStartValue(e.target.value)} />
          </div>
          <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v as "end" | "duration")} aria-label="Give an end or a duration" className="self-start">
            <ToggleGroupItem value="end" className="px-2 text-xs">End</ToggleGroupItem>
            <ToggleGroupItem value="duration" className="px-2 text-xs">Duration</ToggleGroupItem>
          </ToggleGroup>
          {mode === "end" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="entry-end">End</Label>
              <Input id="entry-end" type="datetime-local" value={endValue} onChange={(e) => setEndValue(e.target.value)} aria-invalid={!!error} />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <Label htmlFor="entry-duration">Duration (minutes)</Label>
              <Input id="entry-duration" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-invalid={!!error} />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="entry-description">Description</Label>
            <Input id="entry-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Tag</span>
            <TagPicker value={tagId} onChange={setTagId} className="self-start" />
          </div>
          {entry?.linkTitle ? (
            <p className="text-xs text-text-muted">Linked to {entry.linkTitle}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <Label htmlFor="entry-course">Course</Label>
              <Select value={courseId ?? NO_COURSE} onValueChange={(v) => setCourseId(v === NO_COURSE ? null : v)}>
                <SelectTrigger id="entry-course" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COURSE}>No course</SelectItem>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {c.where}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          {overlaps.length > 0 && (
            <p role="status" className="text-xs text-warning">
              Overlaps with {overlaps.map((o) => `${o.description || "an entry"} (${timeOfDay(Date.parse(o.startedAt), tz)}–${timeOfDay(Date.parse(o.endedAt), tz)})`).join(", ")}.
            </p>
          )}
          {serverError && <p role="alert" className="text-xs text-danger">{serverError}</p>}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="time-entry-form" disabled={!!error || create.isPending || patch.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
