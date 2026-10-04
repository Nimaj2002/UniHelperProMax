import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { calendarPath, lastCalendar, lastCalendarPath } from "@/features/calendar/state";
import { useCreateClass, type ClassCreate } from "./api";
import { ClassForm, classPayload, initialClassForm } from "./ClassForm";

const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Route /classes/new?date=&start=&end= (FR-012 pre-fill from a slot). */
export function NewClassDialog() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const create = useCreateClass();
  const pick = (k: string, re: RegExp) => {
    const v = params.get(k);
    return v && re.test(v) ? v : undefined;
  };
  const initial = initialClassForm({
    date: pick("date", DATE_RE) ?? lastCalendar().date ?? undefined,
    start: pick("start", TIME_RE),
    end: pick("end", TIME_RE),
  });
  const close = () => navigate(lastCalendarPath());

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New class</DialogTitle>
          <DialogDescription>Add a class to your calendar. Repeating classes appear on every chosen weekday.</DialogDescription>
        </DialogHeader>
        <ClassForm
          initial={initial}
          submitLabel="Save class"
          pending={create.isPending}
          onCancel={close}
          onSubmit={async (value) => {
            await create.mutateAsync(classPayload(value) as ClassCreate);
            toast.success("Class saved");
            navigate(calendarPath(lastCalendar().view ?? "week", value.startDate));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
