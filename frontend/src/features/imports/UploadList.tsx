import { ArrowClockwise, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "./audioFiles";
import { importQueue, useImportQueue, type AnyQueue, type UploadEntry, type UploadEvent } from "./importQueue";

function announcement(e: UploadEvent): string {
  const name = e.entry.fileName;
  switch (e.type) {
    case "start":
      return `Uploading ${name}`;
    case "progress":
      return `${name} ${e.percent} % uploaded`;
    case "done":
      return `${name} uploaded`;
    case "cancelled":
      return `${name} upload cancelled`;
    default:
      return e.entry.error?.message ?? `${name} wasn't uploaded`;
  }
}

function Row({ entry, queue: q }: { entry: UploadEntry; queue: AnyQueue }) {
  const percent = entry.total ? Math.min(100, Math.round((entry.loaded / entry.total) * 100)) : 0;
  const problem = entry.state === "failed" || entry.state === "rejected";
  return (
    <li className="grid gap-1.5 rounded-md border border-divider bg-surface-elevated p-2">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={entry.fileName}>{entry.fileName}</span>
          <span className="text-xs text-muted-foreground">{formatBytes(entry.size)}</span>
        </span>
        {!problem && (
          <Button variant="ghost" size="icon-sm" aria-label={`Cancel upload of ${entry.fileName}`} onClick={() => q.cancel(entry.id)}>
            <X size={16} aria-hidden />
          </Button>
        )}
      </div>
      {!problem && (
        <div className="flex items-center gap-2">
          <Progress value={entry.state === "uploading" || entry.state === "verifying" ? percent : 0} aria-label={`Uploading ${entry.fileName}`} className="flex-1" />
          <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {entry.state === "checking" || entry.state === "queued" ? "Waiting…" : entry.state === "verifying" ? "Checking…" : `${percent} %`}
          </span>
        </div>
      )}
      {problem && (
        <div className="grid gap-1.5">
          <p className="flex items-start gap-1.5 text-sm text-danger">
            <WarningCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{entry.error?.message}</span>
          </p>
          <div className="flex gap-2">
            {entry.retryable && (
              <Button size="xs" variant="outline" onClick={() => q.retry(entry.id)} aria-label={`Retry upload of ${entry.fileName}`}>
                <ArrowClockwise aria-hidden /> Retry
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => q.dismiss(entry.id)} aria-label={`Dismiss ${entry.fileName}`}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Uploads into this session: progress, cancel, retry (contracts/ui-import.md). */
export function UploadList({ sessionKey, queue = importQueue() }: { sessionKey: string; queue?: AnyQueue }) {
  const entries = useImportQueue(sessionKey, queue);
  const [live, setLive] = useState("");
  useEffect(
    () =>
      queue.onEvent((e) => {
        if (e.entry.sessionKey === sessionKey) setLive(announcement(e));
      }),
    [sessionKey, queue],
  );
  return (
    <>
      <span className="sr-only" aria-live="polite" data-testid="upload-announcer">{live}</span>
      {entries.length > 0 && (
        <section aria-label="Uploads" className="grid gap-1">
          <ul className="grid gap-1.5">
            {entries.map((e) => (
              <Row key={e.id} entry={e} queue={queue} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
