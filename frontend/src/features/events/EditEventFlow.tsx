import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { applyMove, type MoveTo } from "@/features/calendar/dnd";
import { lastCalendarPath } from "@/features/calendar/state";
import { invalidateSchedule, isRecurring, scopeVersion, useEditSession, type Scope, type Session } from "@/features/classes/api";
import { emptyHierarchy, type HierarchyValue } from "@/features/classes/HierarchyPicker";
import { recurrenceFrom } from "@/features/classes/RecurrenceFields";
import { ScopeDialog } from "@/features/classes/ScopeDialog";
import { useCourseTree, type YearNode } from "@/features/courses/api";
import { isApiError } from "@/lib/api";
import { formatDay, wallTime } from "@/lib/dates";
import type { ColorKey } from "@/lib/palette";
import { eventKeys, useEventDetail, type EventDetail } from "./api";
import { EventForm, eventEditPayload, initialEventForm, type EventFormMode, type EventFormValue } from "./EventForm";

function hierarchyOf(detail: EventDetail, tree: YearNode[]): HierarchyValue {
  for (const y of tree)
    for (const s of y.semesters)
      if (s.semester.id === detail.semesterId)
        return {
          ...emptyHierarchy,
          year: { kind: "existing", id: y.year.id, name: y.year.name },
          semester: { kind: "existing", id: s.semester.id, name: s.semester.name },
        };
  return emptyHierarchy;
}

/** The form's values for one occurrence: what it shows now, with its segment's repetition. */
export function eventFormFromSession(session: Session, detail: EventDetail, tree: YearNode[]): EventFormValue {
  const original = session.key.slice(-10);
  const segment = [...detail.segments].reverse().find((s) => s.startDate <= original) ?? detail.segments[0];
  return initialEventForm({
    title: session.title ?? "",
    hierarchy: hierarchyOf(detail, tree),
    startDate: session.date,
    startTime: wallTime(session.start),
    endTime: wallTime(session.end),
    location: session.location ?? "",
    links: session.links.map((l) => ({ label: l.label ?? "", url: l.url })),
    color: session.color as ColorKey,
    recurrence: segment ? recurrenceFrom(segment) : undefined,
  });
}

export function savedMessage(unchanged: number): string {
  if (unchanged <= 0) return "Saved.";
  return `Saved. ${unchanged} event${unchanged === 1 ? "" : "s"} with notes, recordings or documents, or edited individually, ${unchanged === 1 ? "was" : "were"} left unchanged.`;
}

/** `/sessions/:key/edit` for an event occurrence (009 US3): "This event" / "This and following
 * events" / "All events" for a repeating event, then the event form. The semester is locked
 * while the event has content (FR-018). */
export function EditEventFlow({ session: s }: { session: Session }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detail = useEventDetail(s.lineageId);
  const tree = useCourseTree();
  const edit = useEditSession();
  const [scope, setScope] = useState<Scope | null>(null);
  const moveTo = (useLocation().state as { moveTo?: MoveTo } | null)?.moveTo; // a calendar drop
  const close = () => navigate(lastCalendarPath());

  const recurring = isRecurring(s);
  const chosen: Scope | null = recurring ? scope : "all";
  if (recurring && !chosen) return <ScopeDialog action="edit" noun="event" onChoose={setScope} onCancel={close} />;
  if (!detail.data || tree.isPending) return null;

  const mode: EventFormMode = chosen === "this" ? "edit-this" : "edit-series";
  const initial = eventFormFromSession(s, detail.data, tree.data ?? []);
  const title = chosen === "this" ? `Edit ${formatDay(s.date)}` : chosen === "following" ? "Edit this and following events" : "Edit event";

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {s.title}
            {chosen === "this" && recurring && " — only this date changes; the rest of the event stays as it is."}
            {chosen === "following" && ` — changes apply from ${formatDay(s.date)} onwards.`}
          </DialogDescription>
        </DialogHeader>
        <EventForm
          initial={applyMove(initial, moveTo, recurring && chosen !== "this")}
          mode={mode}
          showDate={mode === "edit-this" || !recurring}
          semesterLocked={detail.data.semesterLocked}
          submitLabel="Save changes"
          pending={edit.isPending}
          onCancel={close}
          onSubmit={async (value) => {
            const body = eventEditPayload(value, initial, mode);
            if (Object.keys(body).length === 0) {
              close();
              return;
            }
            try {
              const result = await edit.mutateAsync({ key: s.key, scope: chosen!, version: scopeVersion(s, chosen!), body });
              await qc.invalidateQueries({ queryKey: eventKeys.all });
              toast.success(savedMessage(result.unchangedCount ?? 0));
              close();
            } catch (err) {
              if (isApiError(err, "version_conflict")) {
                await invalidateSchedule(qc);
                toast.error("This event was changed elsewhere and has been reloaded. Please try again.");
                close();
                return;
              }
              if (isApiError(err, "semester_locked")) await qc.invalidateQueries({ queryKey: eventKeys.all });
              throw err;
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
