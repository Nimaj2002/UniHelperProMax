import { CheckCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { CreateBackupCard } from "./CreateBackupCard";
import { KeysToReenter, RestoreCard } from "./RestoreCard";
import { takeDone } from "./restoreState";
import { SafetyBackupCard } from "./SafetyBackupCard";

/** Settings → Backup & restore (feature 016). */
export function BackupPage() {
  const [done] = useState(takeDone);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Backup &amp; restore</h2>
        <p className="text-sm text-muted-foreground">Keep a copy of everything you have in the app, or bring a copy back.</p>
      </div>
      {done && (
        <div role="status" className="grid gap-1 rounded-lg border border-divider bg-surface-elevated p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle size={18} className="text-success" aria-hidden />
            Your data was restored.
          </p>
          <KeysToReenter keys={done.keysLeftOut} />
        </div>
      )}
      <CreateBackupCard />
      <RestoreCard />
      <SafetyBackupCard />
    </div>
  );
}
