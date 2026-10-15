import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { trashKey } from "@/features/settings/trash/api";
import { LinkedTasksChoice, type LinkedTasksMode } from "@/features/tasks/LinkedTasksChoice";
import { apiFetch, isApiError, type Schemas } from "@/lib/api";
import { formatDay } from "@/lib/dates";
import { invalidateSchedule, isRecurring, scopeVersion, useDeleteSession, useSession, type Scope, type Session } from "./api";
import { ScopeDialog } from "./ScopeDialog";

export type SessionDeletionImpact = Schemas["SessionDeletionImpact"];

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function list(parts: string[]) {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "This will move 1 event with 2 notes, 1 recording and 1 document to the Trash. You can
 * restore it from Settings → Trash." — counts left out when 0 (009 FR-021, R7). Linked tasks
 * (012 FR-043) are named only when they go with the events (`linkedTasks` "delete"). */
export function trashSentence(
  session: Pick<Session, "kind" | "courseName">,
  impact: SessionDeletionImpact,
  linkedTasks: LinkedTasksMode = "keep",
): string {
  const n = impact.occurrences;
  const what =
    session.kind === "event"
      ? plural(n, "event")
      : `${plural(n, "session")}${session.courseName ? ` of ${session.courseName}` : ""}`;
  const content = [
    impact.notes ? plural(impact.notes, "note") : "",
    impact.recordings ? plural(impact.recordings, "recording") : "",
    impact.documents ? plural(impact.documents, "document") : "",
    linkedTasks === "delete" && impact.linkedTaskCount ? plural(impact.linkedTaskCount, "linked task") : "",
  ].filter(Boolean);
  const it = n === 1 ? "it" : "them";
  return `This will move ${what}${content.length ? ` with ${list(content)}` : ""} to the Trash. You can restore ${it} from Settings → Trash.`;
}

function title(s: Session, scope: Scope): string {
  if (s.kind === "event") {
    if (scope === "this") return "Delete this event?";
    return `Delete ${s.title}${scope === "following" ? " from here on" : ""}?`;
  }
  if (scope === "this") return "Delete this session?";
  return `Delete ${s.courseName}${scope === "following" ? " from here on" : ""}?`;
}

function consequence(s: Session, scope: Scope): string {
  const noun = s.kind === "event" ? "event" : "session";
  if (scope === "this") return `Only the ${noun} on ${formatDay(s.date)} is removed from the calendar.`;
  if (scope === "following") return `The ${noun} on ${formatDay(s.date)} and every later one are removed from the calendar.`;
  return s.kind === "event" ? "Every occurrence of this event is removed from the calendar." : "Every session of this class is removed from the calendar.";
}

/** Route /sessions/:sessionKey/delete — scope choice, then a confirmation naming what moves to
 * the Trash (FR-018, 009 FR-021). Nothing is removed before "Move to Trash"; files stay. */
export function DeleteSessionFlow() {
  const { sessionKey = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSession(sessionKey);
  const del = useDeleteSession();
  const [scope, setScope] = useState<Scope | null>(null);
  const [linkedTasks, setLinkedTasks] = useState<LinkedTasksMode>("keep");
  const [error, setError] = useState<string>();
  const close = () => navigate(lastCalendarPath());
  const s = session.data;
  const recurring = s ? isRecurring(s) : false;
  const chosen: Scope | null = recurring ? scope : "all";
  const impact = useQuery({
    queryKey: ["deletion-impact", sessionKey, chosen],
    queryFn: () =>
      apiFetch<SessionDeletionImpact>(`/sessions/${encodeURIComponent(sessionKey)}/deletion-impact`, { query: { scope: chosen! } }),
    enabled: !!s && !!chosen,
    staleTime: 0,
    gcTime: 0,
  });

  if (!s) return null;
  if (recurring && !chosen)
    return <ScopeDialog action="delete" noun={s.kind === "event" ? "event" : "class"} onChoose={setScope} onCancel={close} />;

  const confirm = () =>
    del.mutate(
      {
        key: s.key,
        scope: chosen!,
        version: scopeVersion(s, chosen!),
        linkedTasks: impact.data?.linkedTaskCount ? linkedTasks : undefined,
      },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: trashKey });
          toast.success("Moved to the Trash. You can restore it from Settings → Trash.");
          close();
        },
        onError: async (err) => {
          if (isApiError(err, "version_conflict")) {
            await invalidateSchedule(qc);
            setError(`This ${s.kind === "event" ? "event" : "class"} was changed elsewhere and has been reloaded. Close and try again.`);
          } else setError(isApiError(err) ? err.title : "Couldn't delete. Please retry.");
        },
      },
    );

  return (
    <AlertDialog open onOpenChange={(o) => !o && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title(s, chosen!)}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-2">
              <p>{consequence(s, chosen!)}</p>
              {impact.data ? (
                <p>{trashSentence(s, impact.data, linkedTasks)}</p>
              ) : impact.isError ? null : (
                <p role="status">Checking what this contains…</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {impact.data && (
          <LinkedTasksChoice count={impact.data.linkedTaskCount ?? 0} value={linkedTasks} onChange={setLinkedTasks} />
        )}
        <FormError message={error ?? (impact.isError ? "Couldn't check what this contains. Close and try again." : undefined)} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={!impact.data || del.isPending} onClick={confirm}>
            Move to Trash
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
