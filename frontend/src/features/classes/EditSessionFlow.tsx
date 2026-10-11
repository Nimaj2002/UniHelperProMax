import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { lastCalendarPath } from "@/features/calendar/state";
import { useCourse } from "@/features/courses/api";
import { EditEventFlow } from "@/features/events/EditEventFlow";
import { isApiError } from "@/lib/api";
import { formatDay, wallTime } from "@/lib/dates";
import type { ColorKey } from "@/lib/palette";
import {
  invalidateSchedule, isRecurring, scopeVersion, useClassDetail, useEditSession, useSession,
  type ClassSeries, type Scope, type Session,
} from "./api";
import { ClassForm, initialClassForm, sessionEditPayload, type ClassFormMode, type ClassFormValue } from "./ClassForm";
import { recurrenceFrom } from "./RecurrenceFields";
import { ScopeDialog } from "./ScopeDialog";

export function formFromSession(session: Session, seg: ClassSeries | undefined): ClassFormValue {
  const base = initialClassForm({ date: session.date, start: wallTime(session.start), end: wallTime(session.end) });
  return {
    ...base,
    title: session.title ?? "",
    location: session.location ?? "",
    color: session.color as ColorKey,
    links: session.links.map((l) => ({ label: l.label ?? "", url: l.url })),
    recurrence: seg ? recurrenceFrom(seg) : base.recurrence,
  };
}

function successMessage(scope: Scope, preserved: number) {
  const what = scope === "this" ? "This session was updated" : scope === "following" ? "This and following sessions were updated" : "All sessions were updated";
  return preserved > 0 ? `${what}. ${preserved} individually changed session${preserved === 1 ? " was" : "s were"} kept.` : `${what}.`;
}

/** Route /sessions/:sessionKey/edit — scope choice (recurring only) then the class form;
 * (009) an event occurrence gets the event flow. */
export function EditSessionFlow() {
  const { sessionKey = "" } = useParams();
  const session = useSession(sessionKey);
  if (!session.data) return null;
  if (session.data.kind === "event") return <EditEventFlow session={session.data} />;
  return <EditClassFlow session={session.data} />;
}

function EditClassFlow({ session: s }: { session: Session }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detail = useClassDetail(s.lineageId);
  const course = useCourse(s.courseId ?? undefined);
  const edit = useEditSession();
  const [scope, setScope] = useState<Scope | null>(null);
  const close = () => navigate(lastCalendarPath());

  const recurring = isRecurring(s);
  const chosen: Scope | null = recurring ? scope : "all";
  if (recurring && !chosen) return <ScopeDialog action="edit" onChoose={setScope} onCancel={close} />;
  if (!detail.data) return null;

  const mode: ClassFormMode = chosen === "this" ? "edit-this" : "edit-series";
  const segment = detail.data.segments.find((x) => x.id === s.seriesId);
  const initial = formFromSession(s, segment);
  const title = chosen === "this" ? `Edit ${formatDay(s.date)}` : chosen === "following" ? "Edit this and following sessions" : "Edit class";

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {s.courseName}
            {chosen === "this" && " — only this date changes; the rest of the class stays as it is."}
            {chosen === "following" && ` — changes apply from ${formatDay(s.date)} onwards.`}
          </DialogDescription>
        </DialogHeader>
        <ClassForm
          initial={initial}
          mode={mode}
          fixedSemesterEnd={course.data?.semester.endDate ?? null}
          submitLabel="Save changes"
          pending={edit.isPending}
          onCancel={close}
          onSubmit={async (value) => {
            try {
              const result = await edit.mutateAsync({
                key: s.key, scope: chosen!, version: scopeVersion(s, chosen!), body: sessionEditPayload(value, mode, initial),
              });
              toast.success(successMessage(chosen!, result.preservedOverrides ?? 0));
              close();
            } catch (err) {
              if (isApiError(err, "version_conflict")) {
                await invalidateSchedule(qc);
                toast.error("This class was changed elsewhere and has been reloaded. Please try again.");
                close();
                return;
              }
              throw err;
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
