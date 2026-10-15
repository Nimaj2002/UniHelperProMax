import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useCreateTask } from "../api";

/**
 * A column's quick "Add task" field (FR-015): Enter creates the task at the end of the column,
 * clears the field and keeps focus for the next one; empty input does nothing; Escape clears.
 * The text lives in this component, so a half-typed title survives closing the panel (FR-075).
 */
export function AddTaskField({ columnId, columnName }: { columnId: string; columnName: string }) {
  const [title, setTitle] = useState("");
  const create = useCreateTask();

  const submit = () => {
    const text = title.trim();
    if (!text) return;
    setTitle("");
    create.mutate(
      { title: text, columnId },
      {
        onError: () => {
          // put it back unless something new was typed meanwhile
          setTitle((current) => current || text);
          toast.error("Couldn't add the task");
        },
      },
    );
  };

  return (
    <Input
      value={title}
      maxLength={200}
      placeholder="Add task"
      aria-label={`Add task to ${columnName}`}
      className="h-8 bg-surface-elevated text-sm"
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
  );
}
