import { useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export type LinkedTasksMode = "keep" | "delete";

interface Props {
  /** Tasks linked to the events being deleted; nothing is shown when 0. */
  count: number;
  value: LinkedTasksMode;
  onChange: (value: LinkedTasksMode) => void;
}

/** 012 FR-040: delete dialogs ask what happens to tasks linked to the deleted events. Keeping
 * them (default) turns them into personal tasks; deleting puts them in the same Trash entry. */
export function LinkedTasksChoice({ count, value, onChange }: Props) {
  const uid = useId();
  if (count <= 0) return null;
  const options: { value: LinkedTasksMode; label: string }[] = [
    { value: "keep", label: "Keep as tasks" },
    { value: "delete", label: "Delete with the event" },
  ];
  return (
    <div className="grid gap-2">
      <p id={`${uid}-label`} className="text-sm font-medium text-foreground">
        Linked tasks
      </p>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as LinkedTasksMode)}
        aria-labelledby={`${uid}-label`}
        className="grid gap-2"
      >
        {options.map((o) => (
          <div key={o.value} className="flex items-center gap-2">
            <RadioGroupItem id={`${uid}-${o.value}`} value={o.value} />
            <Label htmlFor={`${uid}-${o.value}`} className="font-normal">{o.label}</Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
