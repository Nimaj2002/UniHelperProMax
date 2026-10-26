import { Archive, DownloadSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { FormError } from "@/components/form/FormError";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useRecorderState } from "@/features/recordings/recorder";
import { cancelJob, download, errorMessage, exportFileUrl, formatBytes, startExport, useJob } from "./api";

/** "Create a backup" (016 US1, contracts/ui-contract.md §1). */
export function CreateBackupCard() {
  const [jobId, setJobId] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string>();
  const job = useJob(jobId).data;
  const recording = useRecorderState().status === "recording";
  const downloaded = useRef<string | undefined>(undefined);

  const phase = job?.phase;
  const running = starting || phase === "preparing" || phase === "writing";
  const ready = phase === "ready";
  const failed = phase === "failed" ? job?.error : undefined;

  useEffect(() => {
    if (ready && job && downloaded.current !== job.id) {
      downloaded.current = job.id;
      download(exportFileUrl(job.id));
    }
  }, [ready, job]);

  const onCreate = async () => {
    setStarting(true);
    setMessage(undefined);
    try {
      setJobId((await startExport()).id);
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const onCancel = async () => {
    if (!jobId) return;
    try {
      await cancelJob(jobId);
    } finally {
      setJobId(undefined);
    }
  };

  const total = job?.bytesTotal ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round(((job?.bytesDone ?? 0) / total) * 100)) : 0;

  return (
    <section aria-labelledby="create-backup-heading" className="space-y-3 rounded-lg border border-divider bg-surface-elevated p-4">
      <div className="space-y-1">
        <h3 id="create-backup-heading" className="text-base font-semibold">
          Create a backup
        </h3>
        <p className="text-sm text-muted-foreground">
          Download one zip file with all your classes, notes, recordings, documents, chats, tasks, events, settings and themes.
          API keys are not included — you'll enter them again after a restore.
        </p>
      </div>
      {recording && <p className="text-sm text-muted-foreground">The recording in progress won't be included.</p>}

      {running && (
        <div className="grid gap-2">
          <p role="status" aria-live="polite" className="text-sm">
            {phase === "writing" ? "Writing the backup…" : "Collecting your data…"}
            {total > 0 && ` ${formatBytes(job?.bytesDone)} of ${formatBytes(total)}`}
          </p>
          <Progress value={percent} aria-label="Backup progress" />
          <div>
            <Button variant="outline" onClick={onCancel} disabled={!jobId}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {ready && job && (
        <div className="grid gap-2">
          <p role="status" aria-live="polite" className="text-sm">
            Your backup is ready ({formatBytes(job.size)}).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => download(exportFileUrl(job.id))}>
              <DownloadSimple size={16} aria-hidden />
              Download again
            </Button>
            <Button variant="ghost" onClick={() => setJobId(undefined)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {!running && !ready && (
        <div className="grid gap-2">
          <FormError message={failed ? errorMessage(failed) : message} />
          <div>
            <Button onClick={onCreate}>
              <Archive size={16} aria-hidden />
              {failed || message ? "Try again" : "Create backup"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
