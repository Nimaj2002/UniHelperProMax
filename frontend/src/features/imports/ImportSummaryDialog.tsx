import { useSyncExternalStore } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface SummaryRow {
  fileName: string;
  /** e.g. "Imported", "Imported as “Lecture 3 (2)”", "Skipped", "Not imported" */
  outcome: string;
  detail?: string;
}

let current: { title: string; rows: SummaryRow[] } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Open the per-file result list (006 FR-025); used by audio and note imports. */
export function showImportSummary(title: string, rows: SummaryRow[]) {
  current = { title, rows };
  emit();
}

export function ImportSummaryHost() {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) {
          current = null;
          emit();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>What happened to each file.</DialogDescription>
        </DialogHeader>
        <ul className="grid max-h-80 gap-2 overflow-y-auto">
          {state?.rows.map((r, i) => (
            <li key={i} className="grid gap-0.5 border-b border-divider pb-2 last:border-b-0">
              <span className="truncate text-sm font-medium" title={r.fileName}>{r.fileName}</span>
              <span className="text-sm text-muted-foreground">
                {r.outcome}
                {r.detail ? ` — ${r.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
