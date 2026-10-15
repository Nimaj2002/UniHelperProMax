/**
 * A task's details (FR-023–FR-027, FR-039): a sheet covering the Tasks panel (not the page), with
 * "Back to tasks", the save state, every field, the checklist, the quick notes and Delete.
 *
 * Fields autosave through `usePatchTask` (600 ms after typing). Closing (Back, Escape) saves what
 * is pending first; when the last save failed it asks instead of closing ("Your last change isn't
 * saved": Keep editing / Retry) — nothing typed is ever dropped (FR-027). A linked task shows its
 * title and due read-only with "Edit event": they follow the event.
 */
import { TZDate } from "@date-fns/tz";
import { ArrowLeft, CalendarCheck, NotePencil, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/features/auth/api";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  useDeleteTask,
  usePatchTask,
  useQuickNotes,
  useTask,
  useTaskColumns,
  useTasks,
  type AutosaveHandle,
  type TaskDetail,
  type TaskFields,
} from "./api";
import { ChecklistEditor } from "./ChecklistEditor";
import { isFailed, SaveState } from "./SaveState";
import { eventWorkspacePath, useMoveToColumn } from "./TaskMenu";
import { useCourseOptions } from "./useCourseOptions";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20_000;
const NO_COURSE = "none";
export const UNSAVED_TITLE = "Your last change isn't saved";

interface Props {
  taskId: string;
  /** Close the sheet (the panel returns focus to the opener). */
  onClose: () => void;
  /** Open the card's quick-note pop-up (anchored to the button that asked). */
  onQuickNotes: (taskId: string, anchor: HTMLElement) => void;
}

/** Focus an element once it is shown (the panel may have just opened). */
function focusWhenShown(find: () => HTMLElement | null | undefined, frames = 12) {
  requestAnimationFrame(() => {
    const el = find();
    if (el && el.offsetParent !== null) return el.focus();
    if (frames > 0) focusWhenShown(find, frames - 1);
  });
}

export function TaskDetails({ taskId, onClose, onQuickNotes }: Props) {
  const query = useTask(taskId);
  const handle = usePatchTask(query.data);
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  const [warn, setWarn] = useState(false);

  useEffect(() => focusWhenShown(() => backRef.current), []);

  // close after pending saves went through; a failed one asks first
  const status = handle.status;
  useEffect(() => {
    if (closing && status === "saved") onClose();
  }, [closing, status, onClose]);
  const asking = warn || (closing && isFailed(status));

  const requestClose = () => {
    if (isFailed(status)) return setWarn(true);
    if (status === "saved") return onClose();
    setClosing(true);
    void handle.flush();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // only keys from the sheet itself (not from a select or menu portalled elsewhere)
    if (e.key !== "Escape" || e.defaultPrevented || !root.current?.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    requestClose();
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape closes the sheet
    <div
      ref={root}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="task-details"
      className="absolute inset-0 z-20 flex flex-col bg-surface-elevated"
      onKeyDown={onKeyDown}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-divider px-1.5">
        <Button ref={backRef} variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={requestClose}>
          <ArrowLeft size={14} aria-hidden />
          Back to tasks
        </Button>
        <h2 id={titleId} className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">
          {query.data?.title ?? "Task"}
        </h2>
        {query.data && (
          <SaveState status={status} onRetry={() => void handle.retry()} testId="task-save-state" className="pr-1" />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending && <p className="p-3 text-sm text-text-muted">Loading…</p>}
        {query.isError && (
          <div className="flex flex-col items-start gap-2 p-3 text-sm">
            <p>Couldn't load this task. It may have been deleted.</p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {query.data && (
          <DetailsForm
            key={query.data.id}
            task={query.data}
            handle={handle}
            onClose={onClose}
            onQuickNotes={onQuickNotes}
          />
        )}
      </div>
      <AlertDialog
        open={asking}
        onOpenChange={(o) => {
          if (o) return;
          setWarn(false);
          setClosing(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{UNSAVED_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>
              It is kept here and saving is retried. Stay to keep editing, or retry now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // stays open until the retry settles: saved closes the sheet, a failure asks again
                e.preventDefault();
                setWarn(false);
                setClosing(true);
                void handle.retry();
              }}
            >
              Retry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FormProps {
  task: TaskDetail;
  handle: AutosaveHandle<TaskFields>;
  onClose: () => void;
  onQuickNotes: (taskId: string, anchor: HTMLElement) => void;
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-text-muted">
        {label}
      </Label>
      {children}
      {hint}
    </div>
  );
}

function DetailsForm({ task, handle, onClose, onQuickNotes }: FormProps) {
  const uid = useId();
  const { data: me } = useMe();
  const tz = me?.timezone ?? "UTC";
  const columns = useTaskColumns();
  const listTask = useTasks().data?.find((t) => t.id === task.id);
  const courses = useCourseOptions();
  const notes = useQuickNotes(task.id);
  const moveTo = useMoveToColumn();
  const remove = useDeleteTask();
  const linked = !!task.event;

  // what is being edited (unsaved values from an earlier opening included)
  const start = handle.values() ?? task;
  const [title, setTitle] = useState(start.title);
  const [description, setDescription] = useState(start.description);
  const [dueDate, setDueDate] = useState(start.dueDate ?? "");
  const [dueTime, setDueTime] = useState(start.dueTime ?? "");
  const [courseId, setCourseId] = useState<string | null>(start.courseId);
  const titleError = !linked && !title.trim() ? "A task needs a title" : null;

  const cols = [...(columns.data ?? [])].sort((a, b) => a.position - b.position);
  const columnId = listTask?.columnId ?? task.columnId;
  const column = cols.find((c) => c.id === columnId);
  const completedAt = column?.countsAsDone ? (listTask?.completedAt ?? task.completedAt) : null;
  const courseKnown = !courseId || courses.some((c) => c.id === courseId);

  const changeColumn = async (id: string) => {
    // the move shares the task's version with the fields: save them first
    await handle.flush();
    moveTo(listTask ?? task, id);
  };

  const quickNoteButton = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex flex-col gap-4 p-3">
      {linked ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-muted">Title</span>
          <p className="flex items-start gap-1.5 text-sm font-medium break-words" data-testid="linked-title">
            <CalendarCheck size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
            <span className="sr-only">Event: </span>
            {task.title}
          </p>
          <p className="text-xs text-text-muted">
            Due {task.dueDate ? formatDay(task.dueDate, "EEE d MMM yyyy") : "—"}
            {task.dueTime && `, ${task.dueTime}`} · follows the event.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm" variant="outline" className="h-7 gap-1 px-2">
              <Link to={`/sessions/${encodeURIComponent(task.event!.sessionKey)}/edit`}>
                <PencilSimple size={12} aria-hidden />
                Edit event
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-7 gap-1 px-2">
              <Link to={eventWorkspacePath(task.event!.sessionKey)}>
                <NotePencil size={12} aria-hidden />
                Open note
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <Field
          label="Title"
          htmlFor={`${uid}-title`}
          hint={
            titleError && (
              <p id={`${uid}-title-error`} className="text-xs text-danger">
                {titleError}
              </p>
            )
          }
        >
          <Input
            id={`${uid}-title`}
            value={title}
            maxLength={TITLE_MAX}
            aria-invalid={!!titleError || undefined}
            aria-describedby={titleError ? `${uid}-title-error` : undefined}
            className="h-8 text-sm"
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) handle.update({ title: e.target.value.trim() });
            }}
          />
        </Field>
      )}

      <Field label="Description" htmlFor={`${uid}-description`}>
        <Textarea
          id={`${uid}-description`}
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={4}
          placeholder="Add details…"
          className="min-h-20 text-sm"
          onChange={(e) => {
            setDescription(e.target.value);
            handle.update({ description: e.target.value });
          }}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 @[24rem]/tasks:grid-cols-2">
        <Field label="Column" htmlFor={`${uid}-column`}>
          <Select value={columnId} onValueChange={(id) => void changeColumn(id)}>
            <SelectTrigger id={`${uid}-column`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cols.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Course" htmlFor={`${uid}-course`}>
          <Select
            value={courseId ?? NO_COURSE}
            onValueChange={(v) => {
              const next = v === NO_COURSE ? null : v;
              setCourseId(next);
              handle.update({ courseId: next });
            }}
          >
            <SelectTrigger id={`${uid}-course`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COURSE}>No course</SelectItem>
              {!courseKnown && courseId && <SelectItem value={courseId}>{task.courseName ?? "Course"}</SelectItem>}
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} <span className="text-text-muted">· {c.where}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {!linked && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date" htmlFor={`${uid}-date`}>
            <Input
              id={`${uid}-date`}
              type="date"
              value={dueDate}
              className="h-8 text-sm"
              onChange={(e) => {
                const value = e.target.value;
                setDueDate(value);
                if (!value) setDueTime("");
                handle.update(value ? { dueDate: value } : { dueDate: null, dueTime: null });
              }}
            />
          </Field>
          <Field label="Time (optional)" htmlFor={`${uid}-time`}>
            <Input
              id={`${uid}-time`}
              type="time"
              value={dueTime}
              disabled={!dueDate}
              className="h-8 text-sm"
              onChange={(e) => {
                setDueTime(e.target.value);
                handle.update({ dueTime: e.target.value || null });
              }}
            />
          </Field>
        </div>
      )}

      {completedAt && (
        <p className="text-xs text-text-muted" data-testid="task-completed">
          Completed {format(new TZDate(Date.parse(completedAt), tz), "EEE d MMM yyyy, HH:mm")}
        </p>
      )}

      <ChecklistEditor task={task} />

      <section aria-labelledby={`${uid}-notes`} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h3 id={`${uid}-notes`} className="text-sm font-medium">
            Quick notes
          </h3>
          <span className="ml-auto" />
          <Button
            ref={quickNoteButton}
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-text-muted"
            onClick={(e) => onQuickNotes(task.id, e.currentTarget)}
          >
            <Plus size={12} weight="bold" aria-hidden />
            New quick note
          </Button>
        </div>
        {notes.data && notes.data.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {notes.data.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="flex w-full min-w-0 flex-col items-start rounded-md border border-divider px-2 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(e) => onQuickNotes(task.id, e.currentTarget)}
                >
                  <span className="w-full truncate font-medium">{n.title || "Untitled"}</span>
                  {n.body && <span className="line-clamp-2 w-full text-xs text-text-muted">{n.body}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          notes.isSuccess && <p className="text-xs text-text-muted">No quick notes.</p>
        )}
      </section>

      <div className={cn("flex border-t border-divider pt-3")}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1 text-danger"
          disabled={remove.isPending}
          onClick={() =>
            // a promise: the sheet's content unmounts when the task leaves the cache
            remove.mutateAsync({ id: task.id, version: listTask?.version ?? task.version }).then(onClose, () =>
              toast.error("Couldn't delete the task"),
            )
          }
        >
          <Trash size={14} aria-hidden />
          Delete task
        </Button>
      </div>
    </div>
  );
}
