import { useEffect, useRef, useState, type FormEvent } from "react";
import { Field } from "@/components/form/Field";
import { FormError } from "@/components/form/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/features/classes/ColorPicker";
import { emptyHierarchy, HierarchyPicker, semesterRef, useSemesterEnd, type HierarchyValue } from "@/features/classes/HierarchyPicker";
import { isValidUrl, LinksEditor, MAX_LINKS, type LinkValue } from "@/features/classes/LinksEditor";
import { defaultRecurrence, recurrencePayload, RecurrenceFields, type RecurrenceValue } from "@/features/classes/RecurrenceFields";
import { isApiError, type ApiError } from "@/lib/api";
import { parseTimeHHmm } from "@/lib/dates";
import type { ColorKey } from "@/lib/palette";

export interface EventFormValue {
  title: string;
  hierarchy: HierarchyValue;
  startDate: string;
  startTime: string;
  endTime: string;
  location: string;
  links: LinkValue[];
  color: ColorKey;
  recurrence: RecurrenceValue;
}

/** Values another form (the quick form, 009 US6) may hand over through router state. */
export type EventPrefill = Partial<Omit<EventFormValue, "hierarchy">> & { hierarchy?: HierarchyValue };

export function initialEventForm(prefill: EventPrefill = {}): EventFormValue {
  return {
    title: "",
    hierarchy: emptyHierarchy,
    startDate: "",
    startTime: "09:00",
    endTime: "10:00",
    location: "",
    links: [],
    color: "blue", // FR-006: independent of any course colour
    recurrence: { ...defaultRecurrence, freq: "none" },
    ...Object.fromEntries(Object.entries(prefill).filter(([, v]) => v !== undefined)),
  };
}

type Errors = Record<string, string>;

/** create: new event · edit-this: one occurrence (every field but the repetition) ·
 * edit-series: this and following / all events (009 US3). */
export type EventFormMode = "create" | "edit-this" | "edit-series";

export const SEMESTER_LOCKED = "The semester can't be changed because this event has notes, recordings or documents.";

/** Same rules as the class form (001), with the event's own: title 1–120, location ≤ 200. */
export function validateEventForm(
  v: EventFormValue,
  semesterEnd: { known: boolean; endDate: string | null },
  mode: EventFormMode = "create",
): Errors {
  const e: Errors = {};
  const title = v.title.trim();
  if (!title) e.title = "Enter a title.";
  else if (title.length > 120) e.title = "Use at most 120 characters.";
  if (!v.hierarchy.year) e.year = "Choose or create a year.";
  if (!v.hierarchy.semester) e.semester = "Choose or create a semester.";
  else if (mode !== "create" && v.hierarchy.semester.kind === "new") e.semester = "Choose an existing semester.";
  if (v.hierarchy.semester?.kind === "new" && v.hierarchy.semesterStart && v.hierarchy.semesterEnd &&
      v.hierarchy.semesterEnd < v.hierarchy.semesterStart)
    e.semesterEnd = "The semester must end on or after it starts.";
  if (!v.startDate) e.startDate = "Choose the date.";
  if (!v.startTime) e.startTime = "Choose a start time.";
  if (!v.endTime) e.endTime = "Choose an end time.";
  else if (v.startTime && parseTimeHHmm(v.endTime) <= parseTimeHHmm(v.startTime))
    e.endTime = "End time must be after the start time.";
  if (v.location.length > 200) e.location = "Use at most 200 characters.";
  v.links.forEach((l, i) => {
    if (!isValidUrl(l.url)) e[`link${i}`] = "Enter a full web address starting with http:// or https://";
  });
  const r = v.recurrence;
  if (r.freq === "weekly") {
    if (r.byWeekday.length === 0) e.byWeekday = "Choose at least one weekday.";
    if (r.endKind === "until") {
      if (!r.untilDate) e.untilDate = "Choose an end date.";
      else if (mode === "create" && v.startDate && r.untilDate < v.startDate) e.untilDate = "The repetition ends before the event starts.";
    }
    if (r.endKind === "count") {
      const n = Number(r.count);
      if (!Number.isInteger(n) || n < 1 || n > 500) e.count = "Repeat between 1 and 500 times.";
    }
    if (r.endKind === "semester_end" && semesterEnd.known && !semesterEnd.endDate)
      e.endKind = "This semester has no end date. Add one, or choose another ending.";
  }
  return e;
}

export function eventPayload(v: EventFormValue) {
  return {
    title: v.title.trim(),
    semester: semesterRef(v.hierarchy),
    startDate: v.startDate,
    startTime: v.startTime,
    endTime: v.endTime,
    location: v.location.trim() || null,
    color: v.color,
    links: v.links.map((l) => ({ label: l.label.trim() || null, url: l.url })),
    recurrence: recurrencePayload(v.recurrence),
  };
}

/** PATCH /sessions/{key} body (`EventEdit`): only the fields the user changed. The semester
 * applies to the whole series whatever the scope (FR-017); `date` moves the occurrence. */
export function eventEditPayload(v: EventFormValue, initial: EventFormValue, mode: EventFormMode): Record<string, unknown> {
  const fields = (x: EventFormValue): Record<string, unknown> => ({
    title: x.title.trim(),
    semesterId: x.hierarchy.semester?.kind === "existing" ? x.hierarchy.semester.id : undefined,
    date: x.startDate,
    startTime: x.startTime,
    endTime: x.endTime,
    location: x.location.trim() || null,
    links: x.links.map((l) => ({ label: l.label.trim() || null, url: l.url })),
    color: x.color,
    ...(mode === "edit-series" ? { recurrence: recurrencePayload(x.recurrence) } : {}),
  });
  const now = fields(v);
  const before = fields(initial);
  return Object.fromEntries(
    Object.entries(now).filter(([k, val]) => val !== undefined && JSON.stringify(val) !== JSON.stringify(before[k])),
  );
}

const SERVER_FIELDS: [string, string][] = [
  ["/semesterId", "semester"], ["/date", "startDate"],
  ["/title", "title"], ["/endTime", "endTime"], ["/startTime", "startTime"], ["/startDate", "startDate"],
  ["/location", "location"],
  ["/recurrence/byWeekday", "byWeekday"], ["/recurrence/end/untilDate", "untilDate"],
  ["/recurrence/end/count", "count"], ["/recurrence/end/kind", "endKind"], ["/recurrence", "byWeekday"],
  ["/semester/new/year", "year"], ["/semester", "semester"], ["/endDate", "semesterEnd"], ["/name", "semester"],
];

/** Server problems mapped next to their fields by JSON pointer (FR-026 keeps every input). */
export function eventServerErrors(err: ApiError): Errors {
  const e: Errors = {};
  for (const fe of err.errors) {
    const match = SERVER_FIELDS.find(([p]) => fe.field === p || fe.field.startsWith(`${p}/`));
    const linkMatch = /^\/links\/(\d+)/.exec(fe.field);
    if (linkMatch) e[`link${linkMatch[1]}`] = fe.message;
    else if (match && !e[match[1]]) e[match[1]] = fe.message;
  }
  if (Object.keys(e).length === 0) e.form = err.status === 0 ? err.title : err.title || "Couldn't save the event.";
  return e;
}

interface Props {
  initial: EventFormValue;
  submitLabel: string;
  pending: boolean;
  onSubmit: (value: EventFormValue) => Promise<unknown>;
  onCancel: () => void;
  mode?: EventFormMode;
  /** edit-series: the date field only for a one-off event (it moves that occurrence). */
  showDate?: boolean;
  /** The semester can't change: content exists (FR-018). */
  semesterLocked?: boolean;
}

/** The full event form (009 FR-003): Title, Year/Semester, Date, Start, End, Location, Links,
 * Color, Repeat. Edit modes (US3) lock the semester while the event has content. */
export function EventForm({
  initial, submitLabel, pending, onSubmit, onCancel, mode = "create", showDate = true, semesterLocked = false,
}: Props) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const semesterEnd = useSemesterEnd(value.hierarchy);
  const set = (patch: Partial<EventFormValue>) => setValue((v) => ({ ...v, ...patch }));

  useEffect(() => {
    if (!attempt || !formRef.current) return;
    const el =
      formRef.current.querySelector<HTMLElement>("[aria-invalid='true']") ??
      formRef.current.querySelector<HTMLElement>("[role='alert']");
    el?.focus();
  }, [attempt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local = validateEventForm(value, semesterEnd, mode);
    setErrors(local);
    if (Object.keys(local).length) {
      setAttempt((a) => a + 1);
      return;
    }
    try {
      await onSubmit(value);
    } catch (err) {
      setErrors(isApiError(err) ? eventServerErrors(err) : { form: "Couldn't save the event. Please retry." });
      setAttempt((a) => a + 1);
    }
  };

  const linkErrors = Object.fromEntries(
    Object.entries(errors).filter(([k]) => k.startsWith("link")).map(([k, msg]) => [Number(k.slice(4)), msg]),
  );

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="grid gap-6">
      <FormError message={errors.form} />
      <Field label="Title" error={errors.title}>
        <Input maxLength={120} value={value.title} onChange={(e) => set({ title: e.target.value })} aria-required />
      </Field>
      <div className="grid gap-2">
        <HierarchyPicker
          levels="semester"
          value={value.hierarchy}
          onChange={(hierarchy) => set({ hierarchy })}
          errors={{ year: errors.year, semester: errors.semester, semesterEnd: errors.semesterEnd }}
          disabled={semesterLocked}
        />
        {semesterLocked && <p className="text-sm text-muted-foreground">{SEMESTER_LOCKED}</p>}
      </div>
      <div className={showDate ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2"}>
        {showDate && (
          <Field label="Date" error={errors.startDate}>
            <Input type="date" value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </Field>
        )}
        <Field label="Start time" error={errors.startTime}>
          <Input type="time" step={300} value={value.startTime} onChange={(e) => set({ startTime: e.target.value })} />
        </Field>
        <Field label="End time" error={errors.endTime}>
          <Input type="time" step={300} value={value.endTime} onChange={(e) => set({ endTime: e.target.value })} />
        </Field>
      </div>
      <Field label="Location (optional)" error={errors.location}>
        <Input maxLength={200} value={value.location} onChange={(e) => set({ location: e.target.value })} />
      </Field>
      <LinksEditor value={value.links.slice(0, MAX_LINKS)} onChange={(links) => set({ links })} errors={linkErrors} />
      <ColorPicker value={value.color} onChange={(color) => set({ color })} />
      {mode !== "edit-this" && (
        <RecurrenceFields
          value={value.recurrence}
          onChange={(recurrence) => set({ recurrence })}
          semesterHasEnd={!semesterEnd.known || !!semesterEnd.endDate}
          errors={{ byWeekday: errors.byWeekday, untilDate: errors.untilDate, count: errors.count, endKind: errors.endKind }}
        />
      )}
      <div className="flex justify-end gap-2 border-t border-divider pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
