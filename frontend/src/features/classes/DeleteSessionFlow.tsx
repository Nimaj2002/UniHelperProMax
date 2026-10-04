import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { FormError } from "@/components/form/FormError";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { lastCalendarPath } from "@/features/calendar/state";
import { isApiError } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import { invalidateSchedule, isRecurring, scopeVersion, useDeleteSession, useSession, type Scope } from "./api";
import { ScopeDialog } from "./ScopeDialog";

function consequence(scope: Scope, date: string): string {
  if (scope === "this") return `Only the session on ${formatDay(date)} is cancelled.`;
  if (scope === "following") return `The session on ${formatDay(date)} and every later session are removed.`;
  return "Every session of this class is removed.";
}

/** Route /sessions/:sessionKey/delete — scope choice, then explicit confirmation (FR-018). */
export function DeleteSessionFlow() {
  const { sessionKey = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession(sessionKey);
  const del = useDeleteSession();
  const [scope, setScope] = useState<Scope | null>(null);
  const [error, setError] = useState<string>();
  const close = () => navigate(lastCalendarPath());

  if (!session.data) return null;
  const s = session.data;
  const recurring = isRecurring(s);
  const chosen: Scope | null = recurring ? scope : "all";
  if (recurring && !chosen) return <ScopeDialog action="delete" onChoose={setScope} onCancel={close} />;

  const confirm = () =>
    del.mutate(
      { key: s.key, scope: chosen!, version: scopeVersion(s, chosen!) },
      {
        onSuccess: () => {
          toast.success(chosen === "this" ? "Session cancelled" : "Sessions deleted");
          close();
        },
        onError: async (err) => {
          if (isApiError(err, "version_conflict")) {
            await invalidateSchedule(qc);
            setError("This class was changed elsewhere and has been reloaded. Close and try again.");
          } else setError(isApiError(err) ? err.title : "Couldn't delete. Please retry.");
        },
      },
    );

  return (
    <AlertDialog open onOpenChange={(o) => !o && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{chosen === "this" ? "Cancel this session?" : `Delete ${s.courseName}${chosen === "following" ? " from here on" : ""}?`}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-2">
              <p>{consequence(chosen!, s.date)}</p>
              <p>Notes and recordings are never deleted — they stay in the course's folder on disk.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <Button variant="destructive" disabled={del.isPending} onClick={confirm}>
            {chosen === "this" ? "Cancel session" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
