import { ArrowCounterClockwise, Trash } from "@phosphor-icons/react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { FormError } from "@/components/form/FormError";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { calendarPath } from "@/features/calendar/state";
import { isApiError } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import { usePurgeEntry, useRestoreEntry, useTrash, type RestoreResult, type TrashEntry } from "./api";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Thu 15 Oct 2026, 14:00–15:30" for one occurrence, "12 occurrences, 2 Oct – 18 Dec 2026"
 * for several. */
export function entryDates(e: TrashEntry): string {
  if (e.occurrenceCount === 1 && e.firstDate === e.lastDate) {
    const day = formatDay(e.firstDate, "EEE d MMM yyyy");
    return e.startTime && e.endTime ? `${day}, ${e.startTime}–${e.endTime}` : day;
  }
  const sameYear = e.firstDate.slice(0, 4) === e.lastDate.slice(0, 4);
  const from = formatDay(e.firstDate, sameYear ? "d MMM" : "d MMM yyyy");
  return `${plural(e.occurrenceCount, "occurrence")}, ${from} – ${formatDay(e.lastDate, "d MMM yyyy")}`;
}

export function entryContent(e: TrashEntry): string {
  const parts = [
    e.noteCount ? plural(e.noteCount, "note") : "",
    e.recordingCount ? plural(e.recordingCount, "recording") : "",
    e.documentCount ? plural(e.documentCount, "document") : "",
    // 012 FR-043: tasks deleted with the event come back linked when it is restored
    e.taskCount ? plural(e.taskCount, "task") : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No notes, recordings or documents";
}

function deletedAgo(iso: string): string {
  try {
    return `Deleted ${formatDistanceToNow(parseISO(iso), { addSuffix: true })}`;
  } catch {
    return "Deleted";
  }
}

function recreatedText(r: RestoreResult, e: TrashEntry): string | undefined {
  const names = [
    r.recreated.year ? `year “${e.yearName}”` : "",
    r.recreated.semester ? `semester “${e.semesterName}”` : "",
    r.recreated.course && e.courseName ? `course “${e.courseName}”` : "",
  ].filter(Boolean);
  return names.length ? `Recreated ${names.join(", ")}.` : undefined;
}

interface EntryProps {
  entry: TrashEntry;
  onRestore: (e: TrashEntry) => void;
  onDelete: (e: TrashEntry) => void;
  busy: boolean;
}

function EntryCard({ entry: e, onRestore, onDelete, busy }: EntryProps) {
  const where = [e.yearName, e.semesterName, e.courseName && e.courseName !== e.label ? e.courseName : ""].filter(Boolean).join(" · ");
  return (
    <li data-entry-id={e.id} className="flex items-start gap-3 rounded-lg border border-divider bg-surface-elevated px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate font-medium">{e.label}</p>
        <p className="text-sm text-muted-foreground">{where}</p>
        <p className="text-sm">{entryDates(e)}</p>
        <p className="text-sm text-muted-foreground">
          {deletedAgo(e.deletedAt)} · {entryContent(e)}
        </p>
        {!!e.missingFiles && (
          <p className="text-sm text-muted-foreground">
            {plural(e.missingFiles, "file")} no longer on disk (removed outside the app).
          </p>
        )}
        {e.purgeError && (
          <p role="alert" className="text-sm text-danger">
            {e.purgeError}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label={`Restore ${e.label}`} disabled={busy} onClick={() => onRestore(e)}>
              <ArrowCounterClockwise size={18} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Restore</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-danger"
              aria-label={`Delete ${e.label} permanently`}
              disabled={busy}
              onClick={() => onDelete(e)}
            >
              <Trash size={18} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete permanently</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}

function Section({ id, title, entries, ...props }: { id: string; title: string; entries: TrashEntry[] } & Omit<EntryProps, "entry">) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} tabIndex={-1} className="text-base font-semibold outline-none">
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in the Trash.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <EntryCard key={e.id} entry={e} {...props} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Settings → Trash (009 FR-021b–d): deleted classes and events, newest first. Restore puts an
 * entry back exactly; Delete asks "Are you sure?" (No is focused) and only "Yes" removes its
 * files from disk. */
export function TrashPage() {
  const navigate = useNavigate();
  const trash = useTrash();
  const restore = useRestoreEntry();
  const purge = usePurgeEntry();
  const [confirming, setConfirming] = useState<TrashEntry | null>(null);
  const [error, setError] = useState<string>();
  const rootRef = useRef<HTMLDivElement>(null);
  const entries = trash.data ?? [];
  const classes = entries.filter((e) => e.kind === "class");
  const events = entries.filter((e) => e.kind === "event");

  /** After an entry leaves the list: focus the next entry's Restore button, else the heading. */
  const focusAfter = (e: TrashEntry) => {
    const list = e.kind === "class" ? classes : events;
    const next = list[list.findIndex((x) => x.id === e.id) + 1] ?? list[list.findIndex((x) => x.id === e.id) - 1];
    const heading = e.kind === "class" ? "trash-classes" : "trash-events";
    requestAnimationFrame(() => {
      const target = next
        ? rootRef.current?.querySelector<HTMLElement>(`[data-entry-id="${next.id}"] button`)
        : document.getElementById(heading);
      target?.focus();
    });
  };

  const onRestore = (e: TrashEntry) => {
    setError(undefined);
    restore.mutate(e, {
      onSuccess: (r) => {
        focusAfter(e);
        toast.success(`Restored ${e.label}`, {
          description: recreatedText(r, e),
          action: { label: "Show in calendar", onClick: () => navigate(calendarPath("week", r.firstSessionKey.slice(-10))) },
        });
      },
      onError: (err) =>
        setError(
          isApiError(err, "version_conflict")
            ? "This entry changed. The list has been reloaded; try again."
            : isApiError(err)
              ? err.title
              : "Couldn't restore. Please retry.",
        ),
    });
  };

  const onConfirmDelete = () => {
    const e = confirming;
    if (!e) return;
    setConfirming(null);
    setError(undefined);
    purge.mutate(e, {
      onSuccess: () => {
        focusAfter(e);
        toast.success(`Deleted ${e.label} permanently`);
      },
      onError: (err) =>
        setError(
          isApiError(err, "purge_failed")
            ? `${err.title} ${((err.problem.failedPaths as string[] | undefined) ?? []).join(", ")}`.trim()
            : isApiError(err)
              ? err.title
              : "Couldn't delete. Please retry.",
        ),
    });
  };

  const busy = restore.isPending || purge.isPending;
  return (
    <div ref={rootRef} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Trash</h2>
        <p className="text-sm text-muted-foreground">
          Deleted classes and events keep their notes, recordings and documents until you delete them here.
        </p>
      </div>
      <FormError message={error} />
      {trash.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">Loading…</p>
      ) : trash.isError ? (
        <FormError message="Couldn't load the Trash. Please reload." />
      ) : (
        <>
          <Section id="trash-classes" title="Deleted classes" entries={classes} onRestore={onRestore} onDelete={setConfirming} busy={busy} />
          <Section id="trash-events" title="Deleted events" entries={events} onRestore={onRestore} onDelete={setConfirming} busy={busy} />
        </>
      )}
      <AlertDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming &&
                `${confirming.label} (${entryDates(confirming)}) and ${
                  entryContent(confirming) === "No notes, recordings or documents"
                    ? "its folder"
                    : `its ${entryContent(confirming).replaceAll(" · ", ", ")}`
                } will be removed from the app and from disk. This can't be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <Button variant="destructive" onClick={onConfirmDelete}>
              Yes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
