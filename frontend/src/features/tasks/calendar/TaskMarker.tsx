import { CheckSquare, Square } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOpenTaskDetails } from "@/features/home/openTask";
import { eventStyle } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { endDrag, startDrag, TASK_MIN } from "@/features/calendar/dnd";
import { columnKeys, taskKeys, useMoveTask, type Task, type TaskColumn } from "../api";
import { columnTasks } from "../model/order";
import type { CalendarTask } from "./useCalendarTasks";

const NO_DONE_COLUMN = "No column counts as done";

/** Where a tick (to done) or an untick (back) moves the task; null when there is nowhere to go. */
export function markerTarget(task: Pick<Task, "columnId" | "previousColumnId">, done: boolean, columns: readonly TaskColumn[]): string | null {
  const ordered = [...columns].sort((a, b) => a.position - b.position);
  if (!done) return ordered.find((c) => c.countsAsDone)?.id ?? null;
  const previous = ordered.find((c) => c.id === task.previousColumnId && !c.countsAsDone);
  return previous?.id ?? ordered.find((c) => !c.countsAsDone)?.id ?? null;
}

interface Props {
  entry: CalendarTask;
  /** Drawn like a calendar entry (the week/day grid) instead of a one-line pill. */
  block?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A task on the calendar (FR-047–FR-050, research R16): a checkbox (ticked = in a done column) and
 * the title, which opens the task's details in the Tasks panel. Done tasks are struck through and
 * dimmed; overdue ones carry a "!" with the text "overdue" (never colour alone).
 */
export function TaskMarker({ entry: { task, done, overdue }, block, className, style }: Props) {
  const qc = useQueryClient();
  const move = useMoveTask();
  const openDetails = useOpenTaskDetails();
  const columns = qc.getQueryData<TaskColumn[]>(columnKeys) ?? [];
  const target = markerTarget(task, done, columns);
  const blocked = !target;

  const toggle = () => {
    if (!target) return;
    const tasks = qc.getQueryData<Task[]>(taskKeys.all) ?? [];
    move.mutate({ id: task.id, version: task.version, columnId: target, index: columnTasks(tasks, target).length });
  };

  const checkbox = (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-disabled={blocked || undefined}
      aria-label={`Done: ${task.title}`}
      onClick={toggle}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-sm text-text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        blocked && "cursor-not-allowed opacity-50",
      )}
    >
      {done ? <CheckSquare size={14} weight="fill" aria-hidden /> : <Square size={14} aria-hidden />}
    </button>
  );

  return (
    <div
      data-task-marker={task.id}
      // a task linked to an event takes its due from the event, so only the event moves
      draggable={!task.event}
      onDragStart={(e) => {
        const [h, m] = (task.dueTime ?? "09:00").split(":").map(Number);
        startDrag(e, {
          kind: "task", id: task.id, version: task.version, dueTime: task.dueTime, name: task.title,
          color: "slate", startMin: h * 60 + m, lengthMin: TASK_MIN,
        });
      }}
      onDragEnd={endDrag}
      className={cn(
        block
          ? "flex min-w-0 items-start gap-0.5 overflow-hidden rounded-[6px] border border-l-[3px] px-1 py-1 text-xs leading-tight"
          : "flex h-5 min-w-0 items-center gap-0.5 rounded-[6px] border border-divider bg-surface-elevated pr-1 pl-0.5 text-xs leading-none text-foreground shadow-xs",
        "data-[dragging]:opacity-40",
        className,
      )}
      style={block ? { ...eventStyle("slate"), ...style } : style}
    >
      {blocked ? (
        <Tooltip>
          <TooltipTrigger asChild>{checkbox}</TooltipTrigger>
          <TooltipContent>{NO_DONE_COLUMN}</TooltipContent>
        </Tooltip>
      ) : (
        checkbox
      )}
      <button
        type="button"
        onClick={() => openDetails(task.id)}
        className={cn(
          "flex min-w-0 items-center gap-0.5 truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
          done && "line-through opacity-60",
        )}
      >
        {overdue && (
          <span className="shrink-0 font-bold text-warning">
            <span aria-hidden>!</span>
            <span className="sr-only">overdue, </span>
          </span>
        )}
        {task.dueTime && <span className="shrink-0 tabular-nums text-text-muted">{task.dueTime}</span>}
        <span className="truncate">{task.title}</span>
      </button>
    </div>
  );
}
