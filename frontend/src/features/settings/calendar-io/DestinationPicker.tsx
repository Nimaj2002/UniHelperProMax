import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { YearNode } from "@/features/courses/api";
import { cn } from "@/lib/utils";
import type { Destination } from "./wizardReducer";

export interface SemesterOption {
  id: string;
  label: string;
  yearName: string;
  semesterName: string;
}

/** "<year> · <semester>" for every semester, newest year first (the course tree's order). */
export function semesterOptions(tree: YearNode[]): SemesterOption[] {
  return tree.flatMap((y) =>
    y.semesters.map((s) => ({
      id: s.semester.id,
      label: `${y.year.name} · ${s.semester.name}`,
      yearName: y.year.name,
      semesterName: s.semester.name,
    })),
  );
}

const NEW_YEAR = "__new__";

/** Step 3 (contracts/ui-import-export.md § Destination block): an existing semester, or a new
 * one (in an existing or new year) whose name is required. */
export function DestinationPicker({
  tree,
  value,
  onChange,
  fromThisApp,
  invalid,
}: {
  tree: YearNode[];
  value: Destination;
  onChange: (d: Destination) => void;
  fromThisApp: boolean;
  invalid?: string;
}) {
  const options = semesterOptions(tree);
  const mode = options.length === 0 ? "new" : value.mode;
  const newValue = value.mode === "new" ? value : { mode: "new" as const, yearName: "", name: "" };
  return (
    <fieldset className="space-y-3" aria-describedby={invalid ? "destination-error" : undefined}>
      <legend className="text-sm font-semibold">Import into</legend>
      {fromThisApp && (
        <p className="text-sm text-muted-foreground">
          Entries keep their saved year and semester. Use “Put in destination” on a group to change that.
        </p>
      )}
      <RadioGroup
        value={mode}
        onValueChange={(m) =>
          onChange(m === "existing" ? { mode: "existing", semesterId: options[0]?.id } : { ...newValue, mode: "new" })
        }
        className="grid gap-3"
        aria-label="Destination semester"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="existing" id="dest-existing" disabled={options.length === 0} />
            <Label htmlFor="dest-existing">Existing semester</Label>
          </div>
          {mode === "existing" && (
            <Select
              value={value.mode === "existing" ? (value.semesterId ?? "") : ""}
              onValueChange={(id) => onChange({ mode: "existing", semesterId: id })}
            >
              <SelectTrigger className={cn("w-64", invalid && "border-danger")} aria-label="Semester">
                <SelectValue placeholder="Choose a semester" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="new" id="dest-new" />
            <Label htmlFor="dest-new">New semester</Label>
          </div>
          {mode === "new" && (
            <div className="flex flex-wrap items-end gap-3 pl-6">
              <div className="grid gap-1">
                <Label htmlFor="dest-year">Year</Label>
                <Select
                  value={newValue.yearId ?? NEW_YEAR}
                  onValueChange={(id) =>
                    onChange({ ...newValue, mode: "new", yearId: id === NEW_YEAR ? undefined : id })
                  }
                >
                  <SelectTrigger id="dest-year" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_YEAR}>New year…</SelectItem>
                    {tree.map((y) => (
                      <SelectItem key={y.year.id} value={y.year.id}>
                        {y.year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!newValue.yearId && (
                <div className="grid gap-1">
                  <Label htmlFor="dest-year-name">New year name</Label>
                  <Input
                    id="dest-year-name"
                    className="w-32"
                    maxLength={80}
                    value={newValue.yearName}
                    onChange={(e) => onChange({ ...newValue, mode: "new", yearName: e.target.value })}
                    placeholder="2026"
                  />
                </div>
              )}
              <div className="grid gap-1">
                <Label htmlFor="dest-semester-name">Semester name</Label>
                <Input
                  id="dest-semester-name"
                  className="w-48"
                  maxLength={80}
                  required
                  aria-invalid={!!invalid && !newValue.name.trim()}
                  value={newValue.name}
                  onChange={(e) => onChange({ ...newValue, mode: "new", name: e.target.value })}
                  placeholder="Fall 2026"
                />
              </div>
            </div>
          )}
        </div>
      </RadioGroup>
      {invalid && (
        <p id="destination-error" className="text-sm text-danger">
          {invalid}
        </p>
      )}
    </fieldset>
  );
}
