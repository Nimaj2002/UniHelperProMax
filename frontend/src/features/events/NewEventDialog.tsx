import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { calendarPath, lastCalendar, lastCalendarPath } from "@/features/calendar/state";
import { useUpdatePreferences } from "@/features/sessions/api";
import { useCreateEvent, type EventCreate } from "./api";
import { EventForm, eventPayload, initialEventForm, type EventPrefill } from "./EventForm";
import { hierarchyFrom, usePreselectedSemester } from "./usePreselectedSemester";

/** Route /events/new (009 FR-002): the full event form over the calendar. Router state may carry
 * `prefill` (values entered elsewhere) and `from` (the open course or semester, FR-004). */
export function NewEventDialog() {
  const navigate = useNavigate();
  const location = useLocation();
  const create = useCreateEvent();
  const updatePrefs = useUpdatePreferences();
  const preselect = usePreselectedSemester();
  const prefill = (location.state as { prefill?: EventPrefill } | null)?.prefill ?? {};
  const close = () => navigate(lastCalendarPath());

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>
            Add a seminar, exam or other event to a semester. Events don't belong to a course.
          </DialogDescription>
        </DialogHeader>
        {preselect.ready ? (
          <EventForm
            initial={initialEventForm({
              startDate: lastCalendar().date ?? undefined,
              ...prefill,
              hierarchy: prefill.hierarchy ?? hierarchyFrom(preselect.pick, initialEventForm().hierarchy),
            })}
            submitLabel="Save event"
            pending={create.isPending}
            onCancel={close}
            onSubmit={async (value) => {
              const made = await create.mutateAsync(eventPayload(value) as EventCreate);
              toast.success("Event created");
              updatePrefs.mutate({ lastSemesterId: made.semesterId });
              navigate(calendarPath("week", value.startDate));
            }}
          />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
