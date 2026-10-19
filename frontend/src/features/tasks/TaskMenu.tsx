/**
 * The actions of a task, shared by board cards and list rows (FR-022): Open, Move to → column,
 * Open note (event-linked tasks only, FR-044) and Delete (with Undo).
 */
import { DotsThree } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { taskKeys, useDeleteTask, useMoveTask, type Task, type TaskColumn } from "./api";
import { columnTasks } from "./model/order";

/** The event workspace of a linked task, as "Open notes" in the session details opens it. */
export const eventWorkspacePath = (sessionKey: string) => `/workspace/${encodeURIComponent(sessionKey)}`;

/** Move to the end of another column (the details' Column select and the menus). */
export function useMoveToColumn() {
  const move = useMoveTask();
  // read the list when moving (not subscribed: every card's menu uses this, and a subscription
  // would re-render all of them on each board change)
  const qc = useQueryClient();
  return (task: Pick<Task, "id" | "version" | "columnId">, columnId: string) => {
    if (columnId === task.columnId) return;
    const tasks = qc.getQueryData<Task[]>(taskKeys.all) ?? [];
    const index = columnTasks(tasks, columnId).filter((t) => t.id !== task.id).length;
    move.mutate({ id: task.id, version: task.version, columnId, index });
  };
}

interface Props {
  task: Task;
  columns: readonly TaskColumn[];
  onOpen: (taskId: string) => void;
  className?: string;
}

export function TaskMenu({ task, columns, onOpen, className }: Props) {
  const navigate = useNavigate();
  const moveTo = useMoveToColumn();
  const remove = useDeleteTask();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-no-drag
          aria-label={`Actions for ${task.title}`}
          className={cn(
            "pointer-events-auto flex size-6 shrink-0 items-center justify-center rounded-sm text-text-muted outline-none hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-surface-hover",
            className,
          )}
        >
          <DotsThree size={16} weight="bold" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => onOpen(task.id)}>Open</DropdownMenuItem>
        {task.event && (
          <DropdownMenuItem onSelect={() => navigate(eventWorkspacePath(task.event!.sessionKey))}>Open note</DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuRadioGroup value={task.columnId} onValueChange={(id) => moveTo(task, id)}>
              {columns.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={c.id}>
                  {c.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() =>
            remove.mutateAsync({ id: task.id, version: task.version }).catch(() => toast.error("Couldn't delete the task"))
          }
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
