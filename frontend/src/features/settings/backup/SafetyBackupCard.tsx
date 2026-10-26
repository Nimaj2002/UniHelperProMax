import { DownloadSimple, FolderOpen } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { desktop, isDesktop } from "@/features/desktop/bridge";
import { download, formatBytes, formatDate, safetyFileUrl, useSafety } from "./api";

/** "Safety backup" (016 FR-014, contracts/ui-contract.md §3). */
export function SafetyBackupCard() {
  const safety = useSafety().data;
  return (
    <section aria-labelledby="safety-heading" className="space-y-3 rounded-lg border border-divider bg-surface-elevated p-4">
      <h3 id="safety-heading" className="text-base font-semibold">
        Safety backup
      </h3>
      {!safety ? (
        <p className="text-sm text-muted-foreground">A safety backup of your data is made automatically before each restore.</p>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm">
            Safety backup from {formatDate(safety.createdAt)} ({formatBytes(safety.size)}). Restore it to undo your last restore.
          </p>
          {safety.path && <p className="break-all font-mono text-xs text-muted-foreground">{safety.path}</p>}
          <div>
            {isDesktop() && safety.path ? (
              <Button variant="outline" onClick={() => void desktop.revealPath(safety.path as string)}>
                <FolderOpen size={16} aria-hidden />
                Show in folder
              </Button>
            ) : (
              <Button variant="outline" onClick={() => download(safetyFileUrl())}>
                <DownloadSimple size={16} aria-hidden />
                Download safety backup
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
