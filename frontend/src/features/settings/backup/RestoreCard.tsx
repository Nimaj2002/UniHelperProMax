import { UploadSimple } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { FormError } from "@/components/form/FormError";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { isApiError } from "@/lib/api";
import {
  cancelJob, confirmRestore, errorMessage, formatBytes, formatDate, uploadBackup, useJob, type BackupJob,
  type RestoreSummary,
} from "./api";
import { restoreState, useRestoreResult } from "./restoreState";
import { RestoreBlockerProbes, serverBlockers, useRestoreBlockers, type Blocker } from "./useRestoreBlockers";

const ROWS: { key: keyof RestoreSummary["counts"]; label: string }[] = [
  { key: "semesters", label: "Semesters" },
  { key: "courses", label: "Courses" },
  { key: "sessions", label: "Class sessions" },
  { key: "events", label: "Events" },
  { key: "notes", label: "Notes" },
  { key: "recordings", label: "Recordings" },
  { key: "documents", label: "Documents" },
  { key: "chats", label: "Chats" },
  { key: "tasks", label: "Tasks" },
  { key: "themes", label: "Themes" },
  { key: "files", label: "Files" },
];

function countsText(c: RestoreSummary["counts"]): string {
  const parts = [
    [c.courses, "course", "courses"],
    [c.notes, "note", "notes"],
    [c.recordings, "recording", "recordings"],
    [c.documents, "document", "documents"],
  ] as const;
  return parts.map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(", ");
}

export function KeysToReenter({ keys }: { keys: { kind: string; name: string }[] }) {
  if (keys.length === 0) return null;
  const transcription = keys.some((k) => k.kind === "transcription_provider");
  const ai = keys.some((k) => k.kind === "ai_endpoint");
  return (
    <p className="text-sm">
      Enter your API keys again in{" "}
      {transcription && (
        <Link className="underline underline-offset-2" to="/settings/transcription">
          Settings → Transcription
        </Link>
      )}
      {transcription && ai && " and "}
      {ai && (
        <Link className="underline underline-offset-2" to="/settings/ai">
          Settings → AI
        </Link>
      )}
      : {keys.map((k) => k.name).join(", ")}.
    </p>
  );
}

function Summary({ s }: { s: RestoreSummary }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        Backup from <strong>{formatDate(s.createdAt)}</strong>, made with version {s.appVersion} ({s.source === "desktop" ? "desktop app" : "web"}).
        {s.willUpgrade && ` Upgraded from an older version (made with ${s.appVersion}).`}
      </p>
      <table className="w-full max-w-md text-sm">
        <caption className="sr-only">What the backup holds, and what you have now</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 font-medium">
              <span className="sr-only">Item</span>
            </th>
            <th scope="col" className="py-1 text-right font-medium">In the backup</th>
            <th scope="col" className="py-1 text-right font-medium">Now</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key} className="border-t border-divider">
              <th scope="row" className="py-1 text-left font-normal">{r.label}</th>
              <td className="py-1 text-right tabular-nums">{s.counts[r.key]}</td>
              <td className="py-1 text-right tabular-nums">{s.current.counts[r.key]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.keysLeftOut.length > 0 && (
        <p className="text-sm">
          API keys aren't in backups. After the restore, enter these again: {s.keysLeftOut.map((k) => k.name).join(", ")}.
        </p>
      )}
      {s.excluded.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Left out when the backup was made: {s.excluded.map((x) => `${x.name} (recording in progress)`).join(", ")}.
        </p>
      )}
      {s.filesNotInBackup > 0 && (
        <p className="text-sm">
          {s.filesNotInBackup} {s.filesNotInBackup === 1 ? "file you have now isn't" : "files you have now aren't"} in the
          backup and will be removed.
        </p>
      )}
    </div>
  );
}

function BlockerList({ blockers }: { blockers: Blocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <ul id="restore-blockers" className="grid gap-1 text-sm text-muted-foreground">
      {blockers.map((b) => (
        <li key={b.key}>{b.message}</li>
      ))}
    </ul>
  );
}

/** "Restore from a backup" (016 US2, contracts/ui-contract.md §2). */
export function RestoreCard() {
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [upload, setUpload] = useState<{ loaded: number; total: number } | null>(null);
  const [jobId, setJobId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [refused, setRefused] = useState<Blocker[]>([]);
  const job = useJob(jobId).data;
  const result = useRestoreResult();
  const blockers = useRestoreBlockers();
  const allBlockers = [...blockers, ...refused.filter((r) => !blockers.some((b) => b.key === r.key))];

  const reset = () => {
    setJobId(undefined);
    setUpload(null);
    setMessage(undefined);
    setRefused([]);
    if (input.current) input.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    restoreState.clearResult();
    setMessage(undefined);
    setRefused([]);
    const controller = new AbortController();
    abort.current = controller;
    setUpload({ loaded: 0, total: file.size });
    try {
      const created = await uploadBackup(file, (loaded, total) => setUpload({ loaded, total }), controller.signal);
      setJobId(created.id);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setMessage(errorMessage(err));
      if (input.current) input.current.value = "";
    } finally {
      setUpload(null);
      abort.current = null;
    }
  };

  const onCancel = async () => {
    abort.current?.abort();
    if (jobId) await cancelJob(jobId).catch(() => undefined);
    reset();
  };

  const onConfirm = async () => {
    if (!jobId) return;
    setConfirming(true);
    try {
      const started = await confirmRestore(jobId);
      restoreState.watch(started.id, true);
      restoreState.update(started);
    } catch (err) {
      if (isApiError(err, "restore_blocked")) setRefused(serverBlockers(err.problem.reasons));
      else setMessage(errorMessage(err));
    } finally {
      setConfirming(false);
    }
  };

  const phase = job?.phase;
  // a confirmed restore that ended without replacing anything (rolled back): back to the start
  const ended = result && result.id === jobId ? result : null;
  const summary: RestoreSummary | undefined =
    phase === "awaiting_confirmation" && !ended ? (job?.summary ?? undefined) : undefined;
  const checking = phase === "validating";
  const failed: BackupJob | undefined = phase === "failed" ? job : undefined;
  const percent = (done: number, total: number | null | undefined) =>
    total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <section aria-labelledby="restore-heading" className="space-y-3 rounded-lg border border-divider bg-surface-elevated p-4">
      <RestoreBlockerProbes />
      <div className="space-y-1">
        <h3 id="restore-heading" className="text-base font-semibold">
          Restore from a backup
        </h3>
        <p className="text-sm text-muted-foreground">Replace all your current data with the contents of a backup file.</p>
      </div>

      {upload && (
        <div className="grid gap-2">
          <p role="status" aria-live="polite" className="text-sm">
            Uploading… {formatBytes(upload.loaded)} of {formatBytes(upload.total)}
          </p>
          <Progress value={percent(upload.loaded, upload.total)} aria-label="Upload progress" />
          <div>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {checking && (
        <div className="grid gap-2">
          <p role="status" aria-live="polite" className="text-sm">
            Checking the backup…
          </p>
          <Progress value={percent(job?.bytesDone ?? 0, job?.bytesTotal)} aria-label="Check progress" />
          <div>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {summary && (
        <div className="grid gap-3">
          <Summary s={summary} />
          <BlockerList blockers={allBlockers} />
          <FormError message={message} />
          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={allBlockers.length > 0 || confirming}
                  aria-describedby={allBlockers.length > 0 ? "restore-blockers" : undefined}
                >
                  Restore…
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Replace all your data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Everything you have now — {countsText(summary.current.counts)} — will be replaced by the backup from{" "}
                    {formatDate(summary.createdAt)}.
                    {summary.filesNotInBackup > 0 &&
                      ` ${summary.filesNotInBackup} ${summary.filesNotInBackup === 1 ? "file that isn't" : "files that aren't"} in the backup will be removed.`}{" "}
                    A safety backup of your current data is made first
                    {summary.safetyBackup.replaces
                      ? `, replacing the one from ${formatDate(summary.safetyBackup.replaces.createdAt)}.`
                      : "."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => void onConfirm()}
                  >
                    Replace my data
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!upload && !checking && !summary && (
        <div className="grid gap-2">
          {ended && (
            <FormError message={`${errorMessage(ended.error)} Nothing was changed.`} />
          )}
          {failed && <FormError message={`${errorMessage(failed.error)} Nothing was changed.`} />}
          <FormError message={message} />
          <div>
            <input
              ref={input}
              id="restore-file"
              type="file"
              accept=".zip,application/zip"
              aria-label="Backup file"
              tabIndex={-1}
              className="sr-only"
              onChange={(e) => {
                setJobId(undefined);
                void onFile(e.target.files?.[0]);
              }}
            />
            <Button onClick={() => input.current?.click()}>
              <UploadSimple size={16} aria-hidden />
              Choose backup file…
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
