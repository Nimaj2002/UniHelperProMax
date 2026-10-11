import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form/FormError";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { problemMessage, undoImport, useRefreshSchedule, type ImportResult as Result, type UndoResult } from "./api";
import { skippedLine } from "./GroupTable";

function n(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function resultSummary(r: Result): string {
  const skipped = r.skipped.filter((s) => s.reason !== "not_selected").length;
  return `Import finished: ${n(r.classes.created, "class", "classes")} and ${n(r.events.created, "event", "events")} created, ${
    r.classes.updated + r.events.updated
  } updated, ${skipped} skipped.`;
}

/** Step 5: what the import did, the reason for every skipped entry, and "Undo import". */
export function ImportResult({ result, onDone, announce }: { result: Result; onDone: () => void; announce: (m: string) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const refresh = useRefreshSchedule();
  const [confirming, setConfirming] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState<UndoResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    headingRef.current?.focus();
    announce(resultSummary(result));
  }, [result, announce]);

  const created = result.classes.created + result.events.created;
  const skipped = result.skipped.filter((s) => s.reason !== "not_selected");
  const notSelected = result.skipped.filter((s) => s.reason === "not_selected");

  const onUndo = async () => {
    setConfirming(false);
    setUndoing(true);
    setError(undefined);
    try {
      const r = await undoImport(result.runId);
      setUndone(r);
      await refresh();
      const removed = r.removed.classes + r.removed.events;
      const message = `Undo finished: ${n(removed, "entry", "entries")} and ${n(r.removed.courses, "course", "courses")} removed, ${r.kept.length} kept.`;
      toast.success(message);
      announce(message);
      headingRef.current?.focus();
    } catch (err) {
      setError(`Undo did not happen. ${problemMessage(err)}`);
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="space-y-4">
      <h4 ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
        {undone ? "Import undone" : "Import finished"}
      </h4>
      <table className="w-full max-w-md text-sm">
        <caption className="sr-only">What the import did</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 font-medium" />
            <th scope="col" className="py-1 font-medium">Created</th>
            <th scope="col" className="py-1 font-medium">Updated</th>
            <th scope="col" className="py-1 font-medium">Skipped</th>
          </tr>
        </thead>
        <tbody>
          {(["classes", "events"] as const).map((k) => (
            <tr key={k} className="border-t border-divider">
              <th scope="row" className="py-1 text-left font-medium">{k === "classes" ? "Classes" : "Events"}</th>
              <td className="py-1">{result[k].created}</td>
              <td className="py-1">{result[k].updated}</td>
              <td className="py-1">{result[k].skipped}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.unchanged > 0 && <p className="text-sm text-muted-foreground">{n(result.unchanged, "entry was", "entries were")} already up to date.</p>}
      {result.coursesCreated.length > 0 && (
        <p className="text-sm">New courses: {result.coursesCreated.map((c) => c.name).join(", ")}</p>
      )}
      {skipped.length > 0 && (
        <section aria-labelledby="skipped-heading" className="space-y-1">
          <h5 id="skipped-heading" className="text-sm font-semibold">
            Skipped ({skipped.length})
          </h5>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {skipped.map((s, i) => (
              <li key={i}>{skippedLine(s)}</li>
            ))}
          </ul>
        </section>
      )}
      {notSelected.length > 0 && (
        <p className="text-sm text-muted-foreground">Not selected: {notSelected.map((s) => s.title).join(", ")}</p>
      )}
      {result.notes.length > 0 && (
        <section aria-labelledby="notes-heading" className="space-y-1">
          <h5 id="notes-heading" className="text-sm font-semibold">Notes</h5>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}
      {undone && undone.kept.length > 0 && (
        <section aria-labelledby="kept-heading" className="space-y-1">
          <h5 id="kept-heading" className="text-sm font-semibold">Kept</h5>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {undone.kept.map((k, i) => (
              <li key={i}>
                {k.title}: {k.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      <FormError message={error} />
      <div className="flex gap-2">
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          {!undone && result.undoAvailable && created > 0 && (
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={undoing}>
                {undoing ? "Undoing…" : "Undo import"}
              </Button>
            </AlertDialogTrigger>
          )}
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Undo this import?</AlertDialogTitle>
              <AlertDialogDescription>
                Remove the {n(result.classes.created, "class", "classes")}, {n(result.events.created, "event", "events")} and{" "}
                {n(result.coursesCreated.length, "course", "courses")} created by this import? Entries with notes, recordings or
                documents are kept. Updated entries stay as they are.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onUndo}>Undo import</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
