/** Feature 006 wiring: upload results, list refresh, and leave/sign-out guards while uploads run. */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { registerGlobalHost, registerSignOutGuard } from "@/app/shell/registry";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { recordingsKey } from "@/features/recordings/api";
import { ImportSummaryHost, showImportSummary, type SummaryRow } from "./ImportSummaryDialog";
import { importQueue, type BatchResult } from "./importQueue";

const OUTCOME: Record<BatchResult["outcome"], string> = {
  imported: "Uploaded",
  cancelled: "Cancelled",
  failed: "Not uploaded",
  rejected: "Not uploaded",
};

/** One toast per pick/drop batch (006 FR-025); "Details" lists every file. */
export function announceBatch(results: BatchResult[]) {
  const settled = results.filter((r) => r.outcome !== "cancelled");
  if (!settled.length) return;
  const ok = settled.filter((r) => r.outcome === "imported").length;
  if (results.length === 1) {
    const [r] = results;
    if (r.outcome === "imported") toast.success(`Uploaded “${r.fileName}”`);
    else toast.error(r.detail ?? `${r.fileName} wasn't uploaded.`);
    return;
  }
  const rows: SummaryRow[] = results.map((r) => ({ fileName: r.fileName, outcome: OUTCOME[r.outcome], detail: r.detail }));
  const text = `Uploaded ${ok} of ${results.length} files`;
  const action = { label: "Details", onClick: () => showImportSummary(text, rows) };
  if (ok === results.length) toast.success(text, { action });
  else toast.warning(text, { action });
}

function ImportLifecycle() {
  const qc = useQueryClient();
  useEffect(() => {
    const q = importQueue();
    q.onUploaded = (sessionKey) => {
      void qc.invalidateQueries({ queryKey: recordingsKey(sessionKey) });
      void qc.invalidateQueries({ queryKey: ["timeline"] });
    };
    q.onBatchSettled = (_sessionKey, results) => announceBatch(results);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (q.hasActiveUploads()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      q.onUploaded = undefined;
      q.onBatchSettled = undefined;
    };
  }, [qc]);
  return null;
}

let pendingSignOut: (() => void) | null = null;
const signOutListeners = new Set<() => void>();

function SignOutWhileUploading() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    signOutListeners.add(show);
    return () => {
      signOutListeners.delete(show);
    };
  }, []);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Uploads in progress</AlertDialogTitle>
          <AlertDialogDescription>Uploads in progress will be cancelled. Files that finished uploading are kept.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep uploading</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              importQueue().cancelAll();
              setOpen(false);
              pendingSignOut?.();
            }}
          >
            Cancel uploads and sign out
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

registerGlobalHost({ id: "import-lifecycle", component: ImportLifecycle });
registerGlobalHost({ id: "import-summary", component: ImportSummaryHost });
registerGlobalHost({ id: "import-signout", component: SignOutWhileUploading });
registerSignOutGuard((proceed) => {
  if (!importQueue().hasActiveUploads()) return true;
  pendingSignOut = proceed;
  signOutListeners.forEach((l) => l());
  return false;
});

export const routes = [];
