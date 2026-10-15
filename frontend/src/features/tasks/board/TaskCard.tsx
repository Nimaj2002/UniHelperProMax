import { CalendarCheck, ListChecks, NotePencil, Warning } from "@phosphor-icons/react";
import type { KeyboardEvent, PointerEvent, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import type { Task, TaskColumn } from "../api";
import { dueLabel } from "../model/dates";

export interface TaskCardProps {
  task: Task;
  /** For "done" (no Overdue in a done column). */
  columns: readonly Pick<TaskColumn, "id" | "countsAsDone">[];
  now: Date;
  tz: string;
  /** Title button or a plain click on the card: open the details (US3). */
  onOpen?: (taskId: string) => void;
  /** The quick-note button (US3); `anchor` is the button (the pop-up is placed at it). */
  onQuickNotes?: (taskId: string, anchor: HTMLElement) => void;
  /** The card's action menu button (Open, Move to, Open note, Delete), beside the title. */
  menu?: ReactNode;
  /** Pointer drag start (from `useBoardDrag`). */
  onPointerDown?: (e: PointerEvent<HTMLElement>, taskId: string) => void;
  /** Keys on the card's move surface (Enter/Space pick up, arrows, Escape). */
  onMoveKeyDown?: (e: KeyboardEvent<HTMLElement>, taskId: string) => void;
  /** Focus left the move surface (a keyboard move in progress is cancelled). */
  onMoveBlur?: (taskId: string) => void;
  cardRef?: Ref<HTMLDivElement>;
  /** Picked up for a keyboard move: `aria-pressed` and a ring. */
  pickedUp?: boolean;
  /** The floating clone that follows the pointer: no handlers, hidden from assistive tech. */
  floating?: boolean;
}

const MOVE_HINT_ID = "task-move-hint";

/** The screen-reader hint every card's move surface points to (render once per board). */
export function TaskMoveHint() {
  return (
    <span id={MOVE_HINT_ID} className="sr-only">
      Press Enter or Space to pick up, arrow keys to move, Enter to drop, Escape to cancel.
    </span>
  );
}

/**
 * A board card (FR-013): title, course, due chip, checklist progress, quick notes and the Event
 * marker. The whole card is a drag surface; a full-size button underneath the content (not
 * wrapping it, so no control is nested in another) takes focus for keyboard moves (FR-016) and
 * a plain click opens the task.
 */
export function TaskCard({
  task,
  columns,
  now,
  tz,
  onOpen,
  onQuickNotes,
  menu,
  onPointerDown,
  onMoveKeyDown,
  onMoveBlur,
  cardRef,
  pickedUp = false,
  floating = false,
}: TaskCardProps) {
  const due = dueLabel(task, now, tz, columns);
  const overdue = due === "Overdue";
  const interactive = !floating;
  return (
    <div
      ref={cardRef}
      data-task-id={floating ? undefined : task.id}
      aria-hidden={floating || undefined}
      onPointerDown={interactive && onPointerDown ? (e) => onPointerDown(e, task.id) : undefined}
      className={cn(
        "group/card relative cursor-grab touch-none select-none rounded-lg border bg-card p-3 text-card-foreground shadow-xs",
        "transition-shadow hover:shadow-sm motion-reduce:transition-none",
        pickedUp && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        floating && "cursor-grabbing",
      )}
    >
      {interactive && (
        <button
          type="button"
          data-drag-surface
          aria-label={`Move ${task.title}`}
          aria-describedby={MOVE_HINT_ID}
          aria-pressed={pickedUp}
          className="absolute inset-0 cursor-grab rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpen?.(task.id)}
          onKeyDown={(e) => onMoveKeyDown?.(e, task.id)}
          onBlur={() => onMoveBlur?.(task.id)}
        />
      )}
      <div className="pointer-events-none relative flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {floating ? (
            <span className="min-w-0 flex-1 break-words text-sm font-medium">{task.title}</span>
          ) : (
            <button
              type="button"
              data-no-drag
              className="pointer-events-auto min-w-0 flex-1 cursor-pointer break-words rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpen?.(task.id)}
            >
              {task.title}
            </button>
          )}
          {task.event && (
            <span className="mt-0.5 shrink-0 text-text-muted" title="Event">
              <CalendarCheck size={14} aria-hidden />
              <span className="sr-only">Event</span>
            </span>
          )}
          {!floating && menu && <span className="-mt-0.5 -mr-1.5 shrink-0">{menu}</span>}
        </div>
        {(task.courseName || due || task.checklistTotal > 0 || task.quickNoteCount > 0 || !floating) && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
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
                className={cn(
                  "inline-flex items-center gap-1",
                  overdue && "font-medium text-danger",
                  due === "Today" && "font-medium text-warning",
                )}
                data-testid="task-due"
              >
                {overdue && <Warning size={12} weight="bold" aria-hidden />}
                {due}
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
            {floating ? (
              task.quickNoteCount > 0 && (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <NotePencil size={12} aria-hidden />
                  {task.quickNoteCount}
                </span>
              )
            ) : (
              <button
                type="button"
                data-no-drag
                data-quick-notes-for={task.id}
                aria-label={`Quick notes (${task.quickNoteCount})`}
                className="pointer-events-auto inline-flex h-6 items-center gap-1 rounded-sm px-1 tabular-nums outline-none hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => onQuickNotes?.(task.id, e.currentTarget)}
              >
                <NotePencil size={12} aria-hidden />
                {task.quickNoteCount > 0 && <span>{task.quickNoteCount}</span>}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
