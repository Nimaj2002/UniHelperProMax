import { Kanban } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SessionActionProps } from "@/features/classes/session-actions";
import { isApiError } from "@/lib/api";
import { useCreateTask, useTaskColumns } from "./api";

/** 012 FR-036: "Add to kanban" in the details of an event occurrence that has no linked task. */
export function AddToKanbanAction({ session }: SessionActionProps) {
  if (session.kind !== "event" || session.taskId) return null;
  return <AddToKanban sessionKey={session.key} />;
}

function AddToKanban({ sessionKey }: { sessionKey: string }) {
  const uid = useId();
  const qc = useQueryClient();
  const create = useCreateTask();
  const columns = useTaskColumns();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const cols = [...(columns.data ?? [])].sort((a, b) => a.position - b.position);
  const columnId = picked && cols.some((c) => c.id === picked) ? picked : (cols[0]?.id ?? null);

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["tasks"] }), qc.invalidateQueries({ queryKey: ["sessions"] }), qc.invalidateQueries({ queryKey: ["session"] })]);

  const add = () => {
    if (!columnId) return;
    create.mutate(
      { eventKey: sessionKey, columnId },
      {
        onSuccess: () => {
          toast.success("Added to the board");
          setOpen(false);
          void refresh();
        },
        onError: (err) => {
          if (isApiError(err, "event_has_task")) {
            toast("This event is already on the board");
            setOpen(false);
          } else toast.error(isApiError(err) ? err.title : "Couldn't add the event to the board. Please retry.");
          void refresh();
        },
      },
    );
  };

  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Kanban size={14} aria-hidden /> Add to kanban
      </Button>
    );

  return (
    <div className="flex w-full flex-wrap items-end gap-2" role="group" aria-label="Add to kanban">
      <div className="grid min-w-0 flex-1 gap-1">
        <Label id={`${uid}-column`}>Column</Label>
        <Select value={columnId ?? undefined} onValueChange={setPicked} disabled={cols.length === 0}>
          <SelectTrigger size="sm" className="w-full" aria-labelledby={`${uid}-column`}>
            <SelectValue placeholder={columns.isPending ? "Loading…" : "No columns"} />
          </SelectTrigger>
          <SelectContent>
            {cols.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      <Button size="sm" onClick={add} disabled={!columnId || create.isPending}>
        {create.isPending ? "Adding…" : "Add"}
      </Button>
    </div>
  );
}
