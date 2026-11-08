import { useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { calendarPath, lastCalendar, lastCalendarPath } from "@/features/calendar/state";
import type { CourseDetail } from "@/features/courses/api";
import { hierarchyFrom, usePreselectedSemester } from "@/features/events/usePreselectedSemester";
import { useUpdatePreferences } from "@/features/sessions/api";
import { tourEvents } from "@/features/tour/events";
import { apiFetch } from "@/lib/api";
import { useCreateClass, type ClassCreate, type ClassCreated } from "./api";
import { ClassForm, classPayload, initialClassForm, type ClassFormValue } from "./ClassForm";

/** The semester a new class went into (for `lastSemesterId`, 009 research R9). */
async function semesterOf(value: ClassFormValue, made: ClassCreated): Promise<string> {
  const picked = value.hierarchy.semester;
  if (picked?.kind === "existing") return picked.id;
  if (made.created.semesterId) return made.created.semesterId;
  return (await apiFetch<CourseDetail>(`/courses/${encodeURIComponent(made.courseId)}`)).semesterId;
}

const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Values another form (the 009 quick form: "More options", "Custom…" repeat) hands over
 * through router state. */
export type ClassPrefill = Partial<ClassFormValue>;

/** Route /classes/new?date=&start=&end= (FR-012 pre-fill from a slot), or with router state
 * `prefill` (009 US6). */
export function NewClassDialog() {
  const [params] = useSearchParams();
  const location = useLocation();
  const prefill = (location.state as { prefill?: ClassPrefill } | null)?.prefill;
  const navigate = useNavigate();
  const create = useCreateClass();
  const updatePrefs = useUpdatePreferences();
  const preselect = usePreselectedSemester();
  const pick = (k: string, re: RegExp) => {
    const v = params.get(k);
    return v && re.test(v) ? v : undefined;
  };
  const base = initialClassForm({
    date: pick("date", DATE_RE) ?? lastCalendar().date ?? undefined,
    start: pick("start", TIME_RE),
    end: pick("end", TIME_RE),
  });
  // 009 FR-004: year and semester of the open course, else the last used
  const initial = prefill
    ? { ...base, ...prefill }
    : { ...base, hierarchy: hierarchyFrom(preselect.pick, base.hierarchy) };
  const close = () => navigate(lastCalendarPath());

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New class</DialogTitle>
          <DialogDescription>Add a class to your calendar. Repeating classes appear on every chosen weekday.</DialogDescription>
        </DialogHeader>
        {preselect.ready ? (
          <ClassForm
            initial={initial}
            submitLabel="Save class"
            pending={create.isPending}
            onCancel={close}
            onSubmit={async (value) => {
              const made = await create.mutateAsync(classPayload(value) as ClassCreate);
              toast.success("Class saved");
              tourEvents.emit("class.created", { courseId: made.courseId }); // 023
              void semesterOf(value, made).then((id) => updatePrefs.mutate({ lastSemesterId: id }), () => undefined);
              navigate(calendarPath(lastCalendar().view ?? "week", value.startDate));
            }}
          />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
