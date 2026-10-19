/**
 * A course's open tasks (FR-052, research R17) on the course page and in a course session's side
 * card: the course's tasks that are not done, a quick add with the course preselected (FR-007),
 * and each task a link to `/?task=<id>` — the home page opens it in the Tasks panel and Back
 * returns here.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useMe } from "@/features/auth/api";
import { taskHref } from "@/features/home/openTask";
import { cn } from "@/lib/utils";
import { useCreateTask, useTaskColumns, useTasks } from "./api";
import { dueLabel, isDone } from "./model/dates";
import { compareByDue } from "./model/group";
import { useNow } from "./useNow";

interface Props {
  courseId: string;
  courseName?: string;
  /** "page": the course page section; "side": the compact side-card section. */
  variant?: "page" | "side";
}

export function CourseTasks({ courseId, courseName, variant = "page" }: Props) {
  const tasks = useTasks();
  const columns = useTaskColumns();
  const { data: me } = useMe();
  const tz = me?.timezone ?? "UTC";
  const now = useNow();
  const create = useCreateTask();
  const [title, setTitle] = useState("");
  const open = useMemo(
    () =>
      (tasks.data ?? [])
        .filter((t) => t.courseId === courseId && !isDone(t, columns.data ?? []))
        .sort(compareByDue),
    [tasks.data, columns.data, courseId],
  );

  const submit = () => {
    const text = title.trim();
    if (!text || create.isPending) return;
    setTitle("");
    create.mutate(
      { title: text, courseId },
      {
        onSuccess: (t) => toast(`Added “${t.title}”`),
        onError: () => {
          setTitle((current) => current || text);
          toast.error("Couldn't add the task");
        },
      },
    );
  };

  const side = variant === "side";
  return (
    <div className={cn("flex flex-col gap-2", side && "px-2 py-1")} data-testid="course-tasks">
      {tasks.isPending && <p className="text-sm text-text-muted">Loading tasks…</p>}
      {tasks.isError && <p className="text-sm text-danger">Couldn't load the tasks.</p>}
      {tasks.isSuccess && open.length === 0 && <p className="text-sm text-text-muted">No open tasks.</p>}
      {open.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={courseName ? `Open tasks of ${courseName}` : "Open tasks"}>
          {open.map((t) => {
            const due = dueLabel(t, now, tz, columns.data);
            return (
              <li key={t.id}>
                <Link
                  to={taskHref(t.id)}
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-md border border-divider px-2 py-1.5 text-sm hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    side && "border-transparent px-1.5 py-1",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  {due && (
                    <span className={cn("shrink-0 text-xs text-text-muted", due === "Overdue" && "font-medium text-danger")}>
                      {due === "Overdue" && <span aria-hidden>! </span>}
                      {due}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Input
        value={title}
        maxLength={200}
        placeholder="Add task"
        aria-label={courseName ? `Add task to ${courseName}` : "Add task to this course"}
        className={cn("h-8 text-sm", side && "h-7")}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && title) {
            e.preventDefault();
            e.stopPropagation();
            setTitle("");
          }
        }}
      />
    </div>
  );
}
