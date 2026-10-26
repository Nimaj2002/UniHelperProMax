/**
 * 016: the full-page "Restoring your data…" overlay (contracts/ui-contract.md §2 step 5) and the
 * app-wide host that shows it, polls the restore, and reloads when it's done.
 */
import { CircleNotch } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { onDataReplaced, onRestoreInProgress, suppressEpochReload } from "@/lib/api/dataEpoch";
import { getJob, isTerminal, type BackupJob } from "./api";
import { rememberDone, restoreState, useRestoreWatch } from "./restoreState";

const PHASES: Partial<Record<BackupJob["phase"], string>> = {
  safety_backup: "Making a safety backup of your current data…",
  staging: "Unpacking the backup…",
  swapping: "Replacing your data…",
  cleanup: "Finishing…",
};

export function RestoreOverlay({ job }: { job?: BackupJob }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    // keep keyboard focus inside: nothing behind the overlay may be used now
    const keep = (e: FocusEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.focus();
    };
    document.addEventListener("focusin", keep);
    return () => document.removeEventListener("focusin", keep);
  }, []);
  const total = job?.bytesTotal ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round(((job?.bytesDone ?? 0) / total) * 100)) : undefined;
  const phase = job ? PHASES[job.phase] : undefined;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background/90 p-6 backdrop-blur-sm">
      <div
        ref={ref}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-busy="true"
        aria-labelledby="restore-overlay-title"
        aria-describedby="restore-overlay-phase"
        className="grid w-full max-w-sm gap-3 rounded-lg border border-divider bg-surface-elevated p-6 text-center shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleNotch size={28} className="mx-auto animate-spin text-muted-foreground" aria-hidden />
        <h2 id="restore-overlay-title" className="text-base font-semibold">
          Restoring your data… Don't close the app.
        </h2>
        <p id="restore-overlay-phase" role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {phase ?? "Please wait."}
        </p>
        {percent !== undefined && <Progress value={percent} aria-label="Restore progress" />}
      </div>
    </div>
  );
}

/** Registered as a global host: one overlay for this tab, whoever started the restore. */
export function RestoreHost() {
  const watch = useRestoreWatch();

  useEffect(
    () =>
      onDataReplaced(() => {
        toast.info("Your data was restored — reloading");
        window.setTimeout(() => window.location.reload(), 1500);
      }),
    [],
  );
  useEffect(() => onRestoreInProgress((jobId) => restoreState.watch(jobId, false)), []);

  const jobId = watch?.jobId;
  const local = watch?.local ?? false;
  useEffect(() => {
    if (!jobId) return;
    suppressEpochReload(true); // this tab reloads by itself when the restore ends
    // closing now is safe (the server finishes or undoes the restore), but ask first; the
    // desktop app turns this into its native "Leave?" box
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const job = await getJob(jobId);
        if (stopped) return;
        restoreState.update(job);
        if (isTerminal(job.phase)) {
          if (job.phase === "done") {
            if (local) rememberDone(job);
            window.removeEventListener("beforeunload", beforeUnload);
            window.location.reload();
            return;
          }
          restoreState.finish(job);
          return;
        }
      } catch {
        /* the server may be busy for a moment: keep polling */
      }
      timer = window.setTimeout(poll, 500);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      suppressEpochReload(false);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [jobId, local]);

  if (!watch) return null;
  return <RestoreOverlay job={watch.job} />;
}
