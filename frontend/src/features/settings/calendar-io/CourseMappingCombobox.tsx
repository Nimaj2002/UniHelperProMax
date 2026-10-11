import { CaretUpDown, Check, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COLOR_LABELS, swatchStyle, type ColorKey } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { nameKey, type CourseChoice, type CourseLite, type CourseTarget } from "./wizardReducer";

/** Which course a Class group goes to: an existing course of the target semester, or a new one
 * (named after the group by default, renamable). Shows the colour by name, never colour alone. */
export function CourseMappingCombobox({
  groupTitle,
  target,
  courses,
  newColor,
  onChange,
  invalid,
}: {
  groupTitle: string;
  target: CourseTarget;
  courses: CourseLite[];
  newColor?: ColorKey;
  onChange: (c: CourseChoice) => void;
  invalid?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const exact = courses.some((c) => nameKey(c.name) === nameKey(typed));
  const color: ColorKey | undefined = target.kind === "existing" ? (target.course.defaultColor as ColorKey) : newColor;
  const label = target.kind === "existing" ? target.course.name : target.name || "Name the course";

  return (
    <div className="grid gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={`Course for ${groupTitle}: ${label}`}
            aria-invalid={!!invalid}
            className={cn("h-auto min-h-8 w-64 justify-between gap-2 px-2 py-1 text-left font-normal", invalid && "border-danger")}
          >
            <span className="flex min-w-0 items-center gap-2">
              {color && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={swatchStyle(color)} />}
              <span className="min-w-0">
                <span className="block truncate">{label}</span>
                <span className="block text-xs text-muted-foreground">
                  {target.kind === "existing" ? "Uses existing course" : "New course"}
                  {color ? ` · ${COLOR_LABELS[color]}` : ""}
                </span>
              </span>
            </span>
            <CaretUpDown size={14} aria-hidden className="shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter>
            <CommandInput placeholder="Search or name a new course" value={query} onValueChange={setQuery} maxLength={120} />
            <CommandList>
              <CommandEmpty>No course with that name.</CommandEmpty>
              {typed && !exact && (
                <CommandGroup heading="New course">
                  <CommandItem
                    value={`new ${typed}`}
                    onSelect={() => {
                      onChange({ kind: "new", name: typed });
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <Plus size={14} aria-hidden /> New course “{typed}”
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup heading="Courses in this semester">
                <CommandItem
                  value={`default ${groupTitle}`}
                  onSelect={() => {
                    onChange({ kind: "auto" });
                    setOpen(false);
                  }}
                >
                  <Plus size={14} aria-hidden /> Match by name (“{groupTitle}”)
                </CommandItem>
                {courses.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`course ${c.name} ${c.id}`}
                    onSelect={() => {
                      onChange({ kind: "existing", id: c.id });
                      setOpen(false);
                    }}
                  >
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={swatchStyle(c.defaultColor as ColorKey)} />
                    <span className="truncate">{c.name}</span>
                    {target.kind === "existing" && target.course.id === c.id && <Check size={14} aria-hidden className="ml-auto" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {invalid && <p className="text-xs text-danger">{invalid}</p>}
    </div>
  );
}
