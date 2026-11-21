/**
 * The Media Editor's state: which recording is open (the `?recording=` URL parameter), whether the
 * open tool has unsaved changes, and the guard that asks before they are thrown away (025 FR-011).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useBlocker, useSearchParams } from "react-router";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EditorState {
  recordingId: string | null;
  dirty: boolean;
  /** The open tool reports unsaved changes. */
  setDirty: (dirty: boolean) => void;
  /** Open another recording; asks first when there are unsaved changes. */
  requestSwitch: (id: string) => void;
}

const Ctx = createContext<EditorState | null>(null);

export function useEditor(): EditorState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditor outside EditorProvider");
  return v;
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const recordingId = params.get("recording");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const open = useCallback(
    (id: string) => {
      setDirty(false);
      setParams({ recording: id }, { replace: true });
    },
    [setParams],
  );
  const requestSwitch = useCallback(
    (id: string) => {
      if (id === recordingId) return;
      if (dirty) setPending(id);
      else open(id);
    },
    [dirty, recordingId, open],
  );

  // leaving the page (links, back button) or closing the tab
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const value = useMemo(() => ({ recordingId, dirty, setDirty, requestSwitch }), [recordingId, dirty, requestSwitch]);
  const leaving = blocker.state === "blocked";
  return (
    <Ctx.Provider value={value}>
      {children}
      <AlertDialog
        open={pending !== null || leaving}
        onOpenChange={(o) => {
          if (o) return;
          setPending(null);
          if (blocker.state === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The selection you made hasn't been saved. Nothing is changed in your recordings until you save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) open(pending);
                else if (blocker.state === "blocked") {
                  setDirty(false);
                  blocker.proceed();
                }
                setPending(null);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}
