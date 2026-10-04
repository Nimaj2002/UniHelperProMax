import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const WEEKDAYS = [
  ["MO", "Mon", "Monday"], ["TU", "Tue", "Tuesday"], ["WE", "Wed", "Wednesday"], ["TH", "Thu", "Thursday"],
  ["FR", "Fri", "Friday"], ["SA", "Sat", "Saturday"], ["SU", "Sun", "Sunday"],
] as const;
export type WeekdayCode = (typeof WEEKDAYS)[number][0];

export interface RecurrenceValue {
  freq: "none" | "weekly";
  intervalWeeks: number;
  byWeekday: WeekdayCode[];
  endKind: "semester_end" | "until" | "count";
  untilDate: string;
  count: string;
}

export const defaultRecurrence: RecurrenceValue = {
  freq: "weekly", intervalWeeks: 1, byWeekday: [], endKind: "semester_end", untilDate: "", count: "14",
};

export function recurrencePayload(v: RecurrenceValue): unknown {
  if (v.freq === "none") return { freq: "none" };
  const end =
    v.endKind === "until" ? { kind: "until", untilDate: v.untilDate || null }
    : v.endKind === "count" ? { kind: "count", count: Number(v.count) }
    : { kind: "semester_end" };
  return { freq: "weekly", intervalWeeks: v.intervalWeeks, byWeekday: v.byWeekday, end };
}

interface Props {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
  semesterHasEnd: boolean;
  errors: Partial<Record<"byWeekday" | "untilDate" | "count" | "endKind", string>>;
}

export function RecurrenceFields({ value, onChange, semesterHasEnd, errors }: Props) {
  const set = (patch: Partial<RecurrenceValue>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-3 text-sm font-medium">Repeat</legend>
      <RadioGroup
        value={value.freq}
        onValueChange={(v) => set({ freq: v as RecurrenceValue["freq"] })}
        className="flex flex-wrap gap-4"
        aria-label="Repeat"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem id="freq-none" value="none" />
          <Label htmlFor="freq-none" className="font-normal">Does not repeat</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id="freq-weekly" value="weekly" />
          <Label htmlFor="freq-weekly" className="font-normal">Weekly</Label>
        </div>
      </RadioGroup>

      {value.freq === "weekly" && (
        <>
          <div className="grid gap-2">
            <span id="weekday-label" className="text-sm font-medium">On</span>
            <ToggleGroup
              type="multiple"
              variant="outline"
              aria-labelledby="weekday-label"
              aria-describedby={errors.byWeekday ? "weekday-error" : undefined}
              value={value.byWeekday}
              onValueChange={(days) =>
                set({ byWeekday: WEEKDAYS.map(([c]) => c).filter((c) => days.includes(c)) as WeekdayCode[] })
              }
              className="flex w-full flex-wrap justify-start"
            >
              {WEEKDAYS.map(([code, short, long]) => (
                <ToggleGroupItem key={code} value={code} aria-label={long} className="min-w-11 flex-1">
                  {short}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {errors.byWeekday && <p id="weekday-error" className="text-sm text-danger">{errors.byWeekday}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="repeat-interval">Every</Label>
            <Select value={String(value.intervalWeeks)} onValueChange={(v) => set({ intervalWeeks: Number(v) })}>
              <SelectTrigger id="repeat-interval" className="w-40" aria-label={`Repeat every ${value.intervalWeeks === 1 ? "week" : `${value.intervalWeeks} weeks`}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>{n === 1 ? "week" : `${n} weeks`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3">
            <span id="ends-label" className="text-sm font-medium">Ends</span>
            <RadioGroup
              aria-labelledby="ends-label"
              value={value.endKind}
              onValueChange={(v) => set({ endKind: v as RecurrenceValue["endKind"] })}
              className="grid gap-3"
            >
              <div className="grid gap-1">
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="end-sem" value="semester_end" disabled={!semesterHasEnd} aria-describedby="end-sem-hint" />
                  <Label htmlFor="end-sem" className="font-normal">When the semester ends</Label>
                </div>
                {!semesterHasEnd && (
                  <p id="end-sem-hint" className="pl-6 text-sm text-muted-foreground">
                    The chosen semester has no end date. Add one above, or choose another ending.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RadioGroupItem id="end-until" value="until" />
                <Label htmlFor="end-until" className="font-normal">On</Label>
                <Input
                  type="date"
                  aria-label="End date"
                  className="w-44"
                  value={value.untilDate}
                  aria-invalid={errors.untilDate ? true : undefined}
                  onChange={(e) => set({ untilDate: e.target.value, endKind: "until" })}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RadioGroupItem id="end-count" value="count" />
                <Label htmlFor="end-count" className="font-normal">After</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  aria-label="Number of sessions"
                  className="w-24"
                  value={value.count}
                  aria-invalid={errors.count ? true : undefined}
                  onChange={(e) => set({ count: e.target.value, endKind: "count" })}
                />
                <span className="text-sm text-muted-foreground">sessions</span>
              </div>
            </RadioGroup>
            {(errors.untilDate || errors.count || errors.endKind) && (
              <p className="text-sm text-danger">{errors.untilDate ?? errors.count ?? errors.endKind}</p>
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}
