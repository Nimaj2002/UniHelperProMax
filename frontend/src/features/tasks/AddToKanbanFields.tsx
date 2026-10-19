import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTaskColumns } from "./api";

/** "Add to kanban" in the event forms (012 FR-035): off by default; the column is the first one
 * unless another is chosen. */
export interface AddToBoardValue {
  enabled: boolean;
  columnId: string | null;
}

export const noAddToBoard: AddToBoardValue = { enabled: false, columnId: null };

/** The `addToBoard` part of `POST /events`, or nothing when the switch is off. */
export function addToBoardPayload(v: AddToBoardValue | undefined): { addToBoard?: { columnId: string } } {
  return v?.enabled && v.columnId ? { addToBoard: { columnId: v.columnId } } : {};
}

export const FIRST_OCCURRENCE_ONLY = "Only the first occurrence is added to the board";

interface Props {
  value: AddToBoardValue;
  onChange: (value: AddToBoardValue) => void;
  /** The event repeats: only its first occurrence becomes a task. */
  repeating: boolean;
}

export function AddToKanbanFields({ value, onChange, repeating }: Props) {
  const uid = useId();
  const columns = useTaskColumns();
  const cols = [...(columns.data ?? [])].sort((a, b) => a.position - b.position);
  const columnId = value.columnId && cols.some((c) => c.id === value.columnId) ? value.columnId : (cols[0]?.id ?? null);

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-3">
        <Switch
          id={`${uid}-switch`}
          checked={value.enabled}
          disabled={cols.length === 0}
          onCheckedChange={(enabled) => onChange({ enabled, columnId })}
          aria-describedby={repeating && value.enabled ? `${uid}-hint` : undefined}
        />
        <Label htmlFor={`${uid}-switch`}>Add to kanban</Label>
      </div>
      {value.enabled && (
        <div className="grid gap-2">
          <Label id={`${uid}-column`}>Column</Label>
          <Select value={columnId ?? undefined} onValueChange={(id) => onChange({ enabled: true, columnId: id })}>
            <SelectTrigger className="w-full" aria-labelledby={`${uid}-column`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cols.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {value.enabled && repeating && (
        <p id={`${uid}-hint`} className="text-sm text-muted-foreground">{FIRST_OCCURRENCE_ONLY}</p>
      )}
      {columns.isError && <p className="text-sm text-muted-foreground">Couldn't load the board's columns.</p>}
    </div>
  );
}
