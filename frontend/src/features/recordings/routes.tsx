/** Feature 003 wiring: workspace audio panel, global recording bar, guards and crash recovery. */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { registerActivity, registerActivitySignal, registerGlobalHost, registerSignOutGuard } from "@/app/shell/registry";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { registerWorkspacePanel } from "@/features/sessions/workspace-panels";
import { recordingsKey } from "./api";
import { recorder, useRecorderState } from "./recorder";
import { RecordingBar } from "./RecordingBar";
import { RecordingHeaderActions, RecordingPanel } from "./RecordingPanel";

let pendingSignOut: (() => void) | null = null;
const signOutListeners = new Set<() => void>();

function SignOutWhileRecording() {
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
          <AlertDialogTitle>Stop the recording before signing out</AlertDialogTitle>
          <AlertDialogDescription>A lecture is being recorded. Stop it to keep the audio safe, then sign out.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep recording</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={async () => {
              await recorder().stop();
              setOpen(false);
              pendingSignOut?.();
            }}
          >
            Stop and sign out
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Starts crash recovery once, shows recorder warnings, refreshes lists when uploads finish. */
function RecordingLifecycle() {
  const qc = useQueryClient();
  useEffect(() => {
    const rec = recorder();
    rec.onWarning = (m) => toast.warning(m, { id: m });
    rec.onFinished = (_r, sessionKey) => {
      void qc.invalidateQueries({ queryKey: recordingsKey(sessionKey) });
      void qc.invalidateQueries({ queryKey: ["timeline"] });
    };
    void rec.recover();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (rec.active || rec.uploader.anyPending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [qc]);
  return null;
}

registerWorkspacePanel({ id: "audio", title: "Audio", component: RecordingPanel, headerActions: RecordingHeaderActions });
registerActivity({ id: "recording-bar", component: RecordingBar, priority: 0 });
registerActivitySignal({
  id: "recording",
  kind: "recording",
  description: "recording in progress",
  priority: 0,
  useActive: () => {
    const { status } = useRecorderState();
    return status === "recording" || status === "stopping";
  },
});
registerGlobalHost({ id: "recording-lifecycle", component: RecordingLifecycle });
registerGlobalHost({ id: "recording-signout", component: SignOutWhileRecording });
registerSignOutGuard((proceed) => {
  if (!recorder().active) return true;
  pendingSignOut = proceed;
  signOutListeners.forEach((l) => l());
  return false;
});

export const routes = [];
