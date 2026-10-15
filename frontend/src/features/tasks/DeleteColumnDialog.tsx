import { useState, type ReactNode } from "react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateColumn, useDeleteColumn, useReorderColumns, type TaskColumn } from "./api";

const UNDO_MS = 10_000;

interface DialogProps {
  column: TaskColumn | null;
  columns: readonly TaskColumn[];
  /** Live tasks in the column, including ones hidden by filters. */
  taskCount: number;
  onOpenChange: (open: boolean) => void;
}

/**
 * Deleting a column that holds tasks (FR-011): asks which remaining column receives them and
 * changes nothing until confirmed.
 */
export function DeleteColumnDialog({ column, columns, taskCount, onOpenChange }: DialogProps) {
  const others = columns.filter((c) => c.id !== column?.id).sort((a, b) => a.position - b.position);
  const [choice, setChoice] = useState<string | null>(null);
  const moveTo = choice && others.some((c) => c.id === choice) ? choice : others[0]?.id;
  const remove = useDeleteColumn();
  const selectId = "delete-column-move-to";

  const confirm = () => {
    if (!column || !moveTo) return;
    remove.mutate(
      { id: column.id, version: column.version, moveTo },
      {
        onSuccess: () => onOpenChange(false),
        onError: () => toast.error("Couldn't delete the column"),
      },
    );
  };

  return (
    <AlertDialog open={!!column} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{column?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            It holds {taskCount} {taskCount === 1 ? "task" : "tasks"}. Choose the column that receives {taskCount === 1 ? "it" : "them"}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={selectId}>
            Move its {taskCount} {taskCount === 1 ? "task" : "tasks"} to
          </Label>
          <Select value={moveTo} onValueChange={setChoice}>
            <SelectTrigger id={selectId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {others.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending || !moveTo}
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The whole delete flow: a column with tasks opens the dialog; an empty one is deleted at once
 * with an Undo toast that re-creates it (name, done flag) at its old position (FR-011, R6).
 */
export function useDeleteColumnFlow(columns: readonly TaskColumn[], liveCount: (columnId: string) => number) {
  const [asking, setAsking] = useState<TaskColumn | null>(null);
  const remove = useDeleteColumn();
  const create = useCreateColumn();
  const reorder = useReorderColumns();

  const undo = async (column: TaskColumn, order: string[]) => {
    try {
      const created = await create.mutateAsync({ name: column.name, countsAsDone: column.countsAsDone });
      const ids = order.map((id) => (id === column.id ? created.id : id));
      await reorder.mutateAsync(ids);
    } catch {
      toast.error("Couldn't restore the column");
    }
  };

  const request = (column: TaskColumn) => {
    if (columns.length <= 1) return;
    if (liveCount(column.id) > 0) return setAsking(column);
    const order = [...columns].sort((a, b) => a.position - b.position).map((c) => c.id);
    remove.mutate(
      { id: column.id, version: column.version },
      {
        onSuccess: () =>
          toast(`Column “${column.name}” deleted`, {
            duration: UNDO_MS,
            action: { label: "Undo", onClick: () => void undo(column, order) },
          }),
        onError: () => toast.error("Couldn't delete the column"),
      },
    );
  };

  const dialog: ReactNode = (
    <DeleteColumnDialog
      key={asking?.id ?? "none"}
      column={asking}
      columns={columns}
      taskCount={asking ? liveCount(asking.id) : 0}
      onOpenChange={(open) => !open && setAsking(null)}
    />
  );
  return { request, dialog };
}
