import { LockKey, WarningCircle } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { apiFetch, isApiError, type Schemas } from "@/lib/api";

export type SecretStoreStatus = Schemas["SecretStoreStatus"];
export const secretStatusKey = ["secrets-status"] as const;

export function useSecretStatus() {
  return useQuery({ queryKey: secretStatusKey, queryFn: () => apiFetch<SecretStoreStatus>("/secrets/status") });
}

/** 014 FR-065/FR-067/FR-068: how saved API keys are protected on this computer, and what to do
 *  when they can't be read. Shown in Settings → Transcription and Settings → AI. */
export function KeyProtectionNotice() {
  const status = useSecretStatus();
  const s = status.data;
  if (!s) return null;
  return (
    <div className="grid gap-2">
      {!s.readable && <UnreadableBanner count={s.unreadableSecrets} />}
      {s.migration === "failed" && s.migrationMessage && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-divider bg-surface-elevated p-3 text-sm">
          <WarningCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{s.migrationMessage}</span>
        </p>
      )}
      {s.readable && s.protectionNote && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <LockKey aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{s.protectionNote}</span>
        </p>
      )}
    </div>
  );
}

function UnreadableBanner({ count }: { count: number }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const reset = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await apiFetch<SecretStoreStatus>("/secrets/reset", { method: "POST", body: { confirm: true } });
      qc.setQueryData(secretStatusKey, next);
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["ai-endpoints"] });
    } catch (err) {
      setError(isApiError(err) ? (err.detail ?? err.title) : "Couldn't start a new key store. Please retry.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="alert" className="grid gap-2 rounded-lg border border-danger/40 bg-surface-elevated p-3 text-sm">
      <p className="flex items-start gap-2">
        <WarningCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
        <span>
          Saved keys can't be read on this computer. Enter them again.
          {count > 0 && ` (${count} saved ${count === 1 ? "key" : "keys"} affected.)`}
        </span>
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="justify-self-start">Start a new key store</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new key store?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved keys that can't be read are removed, and you enter them again afterwards. Notes, recordings, chats
              and all other data stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button type="button" disabled={busy} onClick={reset}>Start a new key store</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
