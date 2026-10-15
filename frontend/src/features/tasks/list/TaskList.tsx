/**
 * The list view (FR-021, FR-022): tasks grouped Overdue, Today, This week, Later, No date, Done,
 * each group a disclosure button with its count (Done collapsed by default; the choice is kept
 * while the app is open). Rows show the title (opens the details), column, course, due,
 * checklist, quick notes and the same menu as the cards.
 */
import { CalendarCheck, CaretRight, ListChecks, NotePencil, Warning } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMe } from "@/features/auth/api";
import { scrollKeys, useScrollMemory } from "@/features/home/scrollMemory";
import { WEEK_OPTS } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useTaskColumns, useTasks, type Task, type TaskColumn } from "../api";
import { dueLabel, type DueBucket } from "../model/dates";
import { groupForList } from "../model/group";
import { TaskMenu } from "../TaskMenu";
import { useNow } from "../useNow";

/** Collapsed groups, kept in module memory (survives closing the panel and leaving the page). */
const collapsed = new Map<DueBucket, boolean>([["done", true]]);

interface Props {
  /** Which tasks are shown (search and filters). */
  filter?: (task: Task) => boolean;
  onOpenTask: (taskId: string) => void;
  onQuickNotes: (taskId: string, anchor: HTMLElement) => void;
}

export function TaskList({ filter, onOpenTask, onQuickNotes }: Props) {
  const tasksQuery = useTasks();
  const columnsQuery = useTaskColumns();
  const { data: me } = useMe();
  const tz = me?.timezone ?? "UTC";
  const now = useNow();
  const columns = useMemo(() => [...(columnsQuery.data ?? [])].sort((a, b) => a.position - b.position), [columnsQuery.data]);
  const groups = useMemo(() => {
    const tasks = tasksQuery.data ?? [];
    return groupForList(filter ? tasks.filter(filter) : tasks, columns, now, tz, WEEK_OPTS.weekStartsOn);
  }, [tasksQuery.data, filter, columns, now, tz]);
  const [closed, setClosed] = useState(() => new Map(collapsed));
  const scrollRef = useScrollMemory<HTMLDivElement>(scrollKeys.list);

  if (tasksQuery.isPending || columnsQuery.isPending) return <p className="p-3 text-sm text-text-muted">Loading tasks…</p>;
  if (tasksQuery.isError || columnsQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-2 p-3 text-sm">
        <p>Couldn't load tasks.</p>
        <Button size="sm" variant="outline" onClick={() => void Promise.all([tasksQuery.refetch(), columnsQuery.refetch()])}>
          Retry
        </Button>
      </div>
    );
  }

  const toggle = (id: DueBucket) => {
    const next = new Map(closed);
    next.set(id, !closed.get(id));
    collapsed.set(id, !closed.get(id));
    setClosed(next);
  };
  const shown = groups.filter((g) => g.tasks.length > 0);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-2" data-testid="task-list">
      {shown.length === 0 && <p className="p-1 text-sm text-text-muted">No tasks</p>}
      {shown.map((g) => {
        const open = !closed.get(g.id);
        const regionId = `task-group-${g.id}`;
        return (
          <section key={g.id} className="mb-2" aria-labelledby={`${regionId}-label`} data-group={g.id}>
            <h3 className="m-0">
              <button
                type="button"
                id={`${regionId}-label`}
                aria-expanded={open}
                aria-controls={regionId}
                className="flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-sm font-semibold outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => toggle(g.id)}
              >
                <CaretRight
                  size={12}
                  weight="bold"
                  aria-hidden
                  className={cn("shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")}
                />
                <span className={cn(g.id === "overdue" && "text-danger")}>{g.label}</span>
                <span className="text-xs font-normal tabular-nums text-text-muted">{g.tasks.length}</span>
              </button>
            </h3>
            {open && (
              <ul id={regionId} className="flex flex-col gap-1 pt-1">
                {g.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    columns={columns}
                    now={now}
                    tz={tz}
                    onOpen={onOpenTask}
                    onQuickNotes={onQuickNotes}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface RowProps {
  task: Task;
  columns: TaskColumn[];
  now: Date;
  tz: string;
  onOpen: (taskId: string) => void;
  onQuickNotes: (taskId: string, anchor: HTMLElement) => void;
}

function TaskRow({ task, columns, now, tz, onOpen, onQuickNotes }: RowProps) {
  const due = dueLabel(task, now, tz, columns);
  const overdue = due === "Overdue";
  const column = columns.find((c) => c.id === task.columnId);
  const done = column?.countsAsDone ?? false;
  return (
    <li
      data-task-id={task.id}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-divider bg-card px-2.5 py-2 text-card-foreground"
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          className={cn(
            "min-w-0 flex-1 break-words rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
            done && "text-text-muted line-through",
          )}
          onClick={() => onOpen(task.id)}
        >
          {task.title}
        </button>
        {task.event && (
          <span className="mt-0.5 shrink-0 text-text-muted" title="Event">
            <CalendarCheck size={14} aria-hidden />
            <span className="sr-only">Event</span>
          </span>
        )}
        <TaskMenu task={task} columns={columns} onOpen={onOpen} className="-mt-0.5 -mr-1" />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
        <span className="rounded-full border border-divider px-1.5" data-testid="task-column">
          <span className="sr-only">Column: </span>
          {column?.name}
        </span>
        {task.courseName && (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1" data-testid="task-course">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full border border-divider"
              style={task.courseColor ? { backgroundColor: task.courseColor } : undefined}
            />
            <span className="truncate">{task.courseName}</span>
          </span>
        )}
        {due && (
          <span
            className={cn("inline-flex items-center gap-1", overdue && "font-medium text-danger", due === "Today" && "font-medium text-warning")}
            data-testid="task-due"
          >
            {overdue && <Warning size={12} weight="bold" aria-hidden />}
            {due}
            {task.dueTime && !overdue && <span className="tabular-nums">{task.dueTime}</span>}
          </span>
        )}
        {task.checklistTotal > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums" data-testid="task-checklist">
            <ListChecks size={12} aria-hidden />
            <span className="sr-only">Checklist </span>
            {task.checklistDone}/{task.checklistTotal}
          </span>
        )}
        <span className="ml-auto" />
        <button
          type="button"
          data-quick-notes-for={task.id}
          aria-label={`Quick notes (${task.quickNoteCount})`}
          className="inline-flex h-6 items-center gap-1 rounded-sm px-1 tabular-nums outline-none hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => onQuickNotes(task.id, e.currentTarget)}
        >
          <NotePencil size={12} aria-hidden />
          {task.quickNoteCount > 0 && <span>{task.quickNoteCount}</span>}
        </button>
      </div>
    </li>
  );
}
