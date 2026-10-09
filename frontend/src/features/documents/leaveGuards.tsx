/**
 * Leaving with unsaved annotations (007 FR-029, ui-reader.md): the browser warns on unload,
 * signing out asks first, and closing a document tab whose changes couldn't be sent yet asks
 * "Close anyway?" — the changes stay queued on the device and are sent when the document opens again.
 */
import { useEffect, useState } from "react";
import { registerGlobalHost, registerSignOutGuard } from "@/app/shell/registry";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { anyPendingAnnotations, flushAnnotations } from "./reader/annotations/registry";

type Ask = { kind: "close" | "signout"; resolve: (go: boolean) => void };
let ask: ((a: Ask) => void) | null = null;

const TEXT = {
  close: {
    title: "Annotations are still being saved",
    body: "Close anyway? They'll be saved when you're back online.",
    go: "Close anyway",
    stay: "Keep the document open",
  },
  signout: {
    title: "Annotations are still being saved",
    body: "Sign out anyway? They stay on this device and are saved the next time you open the document.",
    go: "Sign out anyway",
    stay: "Stay signed in",
  },
};

/** Before closing a document tab: true when it may close now. */
export async function confirmCloseDocument(documentId: string): Promise<boolean> {
  if (await flushAnnotations(documentId)) return true;
  if (!ask) return true;
  return new Promise((resolve) => ask?.({ kind: "close", resolve }));
}

function AnnotationLeaveGuards() {
  const [pending, setPending] = useState<Ask | null>(null);
  useEffect(() => {
    ask = setPending;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (anyPendingAnnotations()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      ask = null;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  const answer = (go: boolean) => {
    pending?.resolve(go);
    setPending(null);
  };
  const text = TEXT[pending?.kind ?? "close"];
  return (
    <AlertDialog open={pending !== null} onOpenChange={(o) => !o && answer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{text.stay}</AlertDialogCancel>
          <Button variant="destructive" onClick={() => answer(true)}>
            {text.go}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

registerGlobalHost({ id: "annotation-leave-guards", component: AnnotationLeaveGuards });
registerSignOutGuard((proceed) => {
  if (!anyPendingAnnotations() || !ask) return true;
  ask({ kind: "signout", resolve: (go) => go && proceed() });
  return false;
});
