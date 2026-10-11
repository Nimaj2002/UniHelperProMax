import { CaretDown, Info } from "@phosphor-icons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ColorKey } from "@/lib/palette";
import type { ImportGroup, SkippedItem } from "./api";
import { CourseMappingCombobox } from "./CourseMappingCombobox";
import {
  courseTarget,
  nameKey,
  type Action,
  type CourseLite,
  type GroupState,
  type Problem,
  usesSaved,
} from "./wizardReducer";

const DAY_NAMES: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };

/** "27 entries · Mon, Wed 10:00–11:30 · FENS G032" */
export function groupSummary(g: ImportGroup): string {
  const times = g.patterns.map((p) => `${p.weekdays.map((d) => DAY_NAMES[d] ?? d).join(", ")} ${p.startTime}–${p.endTime}`);
  return [`${g.occurrenceCount} ${g.occurrenceCount === 1 ? "entry" : "entries"}`, ...times, g.location ?? ""]
    .filter(Boolean)
    .join(" · ");
}

export function skippedLine(s: SkippedItem): string {
  const when = [s.date ?? "", s.startTime ?? ""].filter(Boolean).join(" ");
  return `${s.title}${when ? ` (${when})` : ""}: ${s.message}`;
}

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <CaretDown size={12} aria-hidden className={open ? "rotate-180" : ""} /> {label}
      </button>
      {open && <div className="mt-1 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

interface RowProps {
  group: ImportGroup;
  state: GroupState;
  courses: CourseLite[];
  newColor?: ColorKey;
  problem?: Problem;
  dispatch: (a: Action) => void;
}

function GroupRow({ group: g, state: gs, courses, newColor, problem, dispatch }: RowProps) {
  const id = g.groupId;
  const target = courseTarget(g, gs, courses);
  const err = (field: Problem["field"]) => (problem?.groupId === id && problem.field === field ? problem.message : undefined);
  const skipped = g.skipped.length + g.matches.skip;
  return (
    <li
      data-group-id={id}
      className="grid gap-3 rounded-lg border border-divider bg-surface-elevated px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Checkbox
          id={`g-${id}`}
          className="mt-1"
          checked={gs.selected}
          onCheckedChange={(v) => dispatch({ type: "toggle", groupId: id, selected: v === true })}
          aria-label={`Import ${g.title}`}
        />
        <div className="min-w-0 space-y-1">
          <label htmlFor={`g-${id}`} className="block truncate font-medium" title={g.title}>
            {g.title}
          </label>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline">{g.repeating ? "Repeating" : "One time"}</Badge>
            {g.saved && <Badge variant="secondary">From this app · {g.saved.yearName} · {g.saved.semesterName}</Badge>}
            {g.unsupported && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="border-danger text-danger" tabIndex={0}>
                    <Info size={12} aria-hidden /> Not supported
                    <span className="sr-only">: {g.unsupported}</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Not supported: {g.unsupported}</TooltipContent>
              </Tooltip>
            )}
            {g.matches.update > 0 && <Badge variant="outline">{g.matches.update} will update</Badge>}
            {skipped > 0 && <Badge variant="outline">{skipped} skipped</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{groupSummary(g)}</p>
          {(g.notes.length > 0 || g.skipped.length > 0) && (
            <Disclosure label="Details">
              <ul className="list-disc space-y-0.5 pl-4">
                {g.skipped.map((s, i) => (
                  <li key={`s${i}`}>{skippedLine(s)}</li>
                ))}
                {g.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      </div>

      <div className="grid content-start gap-3 md:justify-items-end">
        <RadioGroup
          value={gs.importAs}
          onValueChange={(v) => dispatch({ type: "setType", groupId: id, importAs: v as "class" | "event" })}
          className="flex gap-3"
          aria-label={`Import ${g.title} as`}
        >
          <span className="text-sm text-muted-foreground">Import as</span>
          {(["class", "event"] as const).map((k) => (
            <div key={k} className="flex items-center gap-1.5">
              <RadioGroupItem value={k} id={`g-${id}-${k}`} />
              <Label htmlFor={`g-${id}-${k}`}>{k === "class" ? "Class" : "Event"}</Label>
            </div>
          ))}
        </RadioGroup>

        {g.titleMissing && (
          <div className="grid gap-1">
            <Label htmlFor={`g-${id}-title`}>{gs.importAs === "class" ? "Course name" : "Title"}</Label>
            <Input
              id={`g-${id}-title`}
              className="w-64"
              maxLength={120}
              value={gs.title}
              aria-invalid={!!(err("title") || err("course"))}
              onChange={(e) => dispatch({ type: "setTitle", groupId: id, title: e.target.value })}
            />
            {(err("title") || err("course")) && <p className="text-xs text-danger">{err("title") ?? err("course")}</p>}
          </div>
        )}

        {gs.importAs === "class" && !g.titleMissing && (
          <CourseMappingCombobox
            groupTitle={g.title}
            target={target}
            courses={courses}
            newColor={target.kind === "new" ? (g.saved?.color as ColorKey | undefined) ?? newColor : undefined}
            invalid={err("course")}
            onChange={(course) => dispatch({ type: "setCourse", groupId: id, course })}
          />
        )}

        {g.saved && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`g-${id}-dest`}
              checked={gs.semester === "destination"}
              onCheckedChange={(v) => dispatch({ type: "setSemester", groupId: id, semester: v === true ? "destination" : "saved" })}
            />
            <Label htmlFor={`g-${id}-dest`}>Put in destination</Label>
          </div>
        )}

        {g.openEnded && (
          <div className="grid gap-1">
            <Label htmlFor={`g-${id}-end`}>Repeats until</Label>
            <Input
              id={`g-${id}-end`}
              type="date"
              className="w-44"
              min={g.firstDate ?? undefined}
              value={gs.endDate ?? ""}
              aria-invalid={!!err("endDate")}
              onChange={(e) => dispatch({ type: "setEndDate", groupId: id, endDate: e.target.value })}
            />
            {err("endDate") && <p className="text-xs text-danger">{err("endDate")}</p>}
          </div>
        )}

        {g.unsupported && (
          <fieldset className="grid gap-1">
            <legend className="text-sm">This repetition can’t be imported as is</legend>
            <RadioGroup
              value={gs.unsupported ?? ""}
              onValueChange={(v) => dispatch({ type: "setUnsupported", groupId: id, choice: v as "first_only" | "skip" })}
              aria-label={`What to do with ${g.title}`}
              aria-invalid={!!err("unsupported")}
              className="flex flex-wrap gap-3"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="first_only" id={`g-${id}-first`} />
                <Label htmlFor={`g-${id}-first`}>Import first occurrence only</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="skip" id={`g-${id}-skip`} />
                <Label htmlFor={`g-${id}-skip`}>Skip</Label>
              </div>
            </RadioGroup>
            {err("unsupported") && <p className="text-xs text-danger">Choose what to do with this repetition</p>}
          </fieldset>
        )}
      </div>
    </li>
  );
}

/** Step 2 (contracts/ui-import-export.md § Groups table): one row per group. */
export function GroupTable({
  groups,
  states,
  coursesFor,
  newColors,
  problem,
  dispatch,
}: {
  groups: ImportGroup[];
  states: Record<string, GroupState>;
  coursesFor: (g: ImportGroup, gs: GroupState) => CourseLite[];
  newColors: Record<string, ColorKey>;
  problem?: Problem;
  dispatch: (a: Action) => void;
}) {
  return (
    <section aria-labelledby="groups-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="groups-heading" className="text-sm font-semibold">
          Found in the file
        </h4>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => dispatch({ type: "selectAll", selected: true })}>
            Select all
          </Button>
          <Button variant="outline" size="sm" onClick={() => dispatch({ type: "selectAll", selected: false })}>
            Clear
          </Button>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">The file has no events that can be imported.</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => {
            const gs = states[g.groupId];
            if (!gs) return null;
            const target = courseTarget(g, gs, coursesFor(g, gs));
            const newColor = target.kind === "new" && !usesSaved(g, gs) ? newColors[nameKey(target.name)] : undefined;
            return (
              <GroupRow
                key={g.groupId}
                group={g}
                state={gs}
                courses={coursesFor(g, gs)}
                newColor={newColor}
                problem={problem}
                dispatch={dispatch}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
