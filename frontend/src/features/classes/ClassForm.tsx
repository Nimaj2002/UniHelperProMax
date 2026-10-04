import { useEffect, useRef, useState, type FormEvent } from "react";
import { Field } from "@/components/form/Field";
import { FormError } from "@/components/form/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCourses } from "@/features/courses/api";
import { isApiError, type ApiError } from "@/lib/api";
import { parseTimeHHmm } from "@/lib/dates";
import type { ColorKey } from "@/lib/palette";
import { ColorPicker } from "./ColorPicker";
import { courseRef, emptyHierarchy, HierarchyPicker, useSemesterEnd, type HierarchyValue } from "./HierarchyPicker";
import { isValidUrl, LinksEditor, MAX_LINKS, type LinkValue } from "./LinksEditor";
import { defaultRecurrence, recurrencePayload, RecurrenceFields, type RecurrenceValue } from "./RecurrenceFields";

export interface ClassFormValue {
  hierarchy: HierarchyValue;
  title: string;
  startDate: string;
  startTime: string;
  endTime: string;
  location: string;
  links: LinkValue[];
  color: ColorKey;
  recurrence: RecurrenceValue;
}

export function initialClassForm(prefill: { date?: string; start?: string; end?: string } = {}): ClassFormValue {
  return {
    hierarchy: emptyHierarchy,
    title: "",
    startDate: prefill.date ?? "",
    startTime: prefill.start ?? "09:00",
    endTime: prefill.end ?? "10:00",
    location: "",
    links: [],
    color: "blue",
    recurrence: { ...defaultRecurrence },
  };
}

type Errors = Record<string, string>;

/** create: new class · edit-this: one session (time + location) · edit-series: following/all */
export type ClassFormMode = "create" | "edit-this" | "edit-series";

export function validateClassForm(
  v: ClassFormValue,
  semesterEnd: { known: boolean; endDate: string | null },
  mode: ClassFormMode = "create",
): Errors {
  const e: Errors = {};
  if (mode === "edit-this") {
    if (!v.startTime) e.startTime = "Choose a start time.";
    if (!v.endTime) e.endTime = "Choose an end time.";
    else if (v.startTime && parseTimeHHmm(v.endTime) <= parseTimeHHmm(v.startTime))
      e.endTime = "End time must be after the start time.";
    if (v.location.length > 120) e.location = "Use at most 120 characters.";
    return e;
  }
  if (mode === "create") {
    if (!v.hierarchy.year) e.year = "Choose or create a year.";
    if (!v.hierarchy.semester) e.semester = "Choose or create a semester.";
    if (!v.hierarchy.course) e.course = "Choose or create a course.";
  }
  if (v.hierarchy.semester?.kind === "new" && v.hierarchy.semesterStart && v.hierarchy.semesterEnd &&
      v.hierarchy.semesterEnd < v.hierarchy.semesterStart)
    e.semesterEnd = "The semester must end on or after it starts.";
  if (mode === "create" && !v.startDate) e.startDate = "Choose the date of the first session.";
  if (!v.startTime) e.startTime = "Choose a start time.";
  if (!v.endTime) e.endTime = "Choose an end time.";
  else if (v.startTime && parseTimeHHmm(v.endTime) <= parseTimeHHmm(v.startTime))
    e.endTime = "End time must be after the start time.";
  if (v.title.length > 60) e.title = "Use at most 60 characters.";
  if (v.location.length > 120) e.location = "Use at most 120 characters.";
  v.links.forEach((l, i) => {
    if (!isValidUrl(l.url)) e[`link${i}`] = "Enter a full web address starting with http:// or https://";
  });
  const r = v.recurrence;
  if (r.freq === "weekly") {
    if (r.byWeekday.length === 0) e.byWeekday = "Choose at least one weekday.";
    if (r.endKind === "until") {
      if (!r.untilDate) e.untilDate = "Choose an end date.";
      else if (mode === "create" && v.startDate && r.untilDate < v.startDate)
        e.untilDate = "The repetition ends before the class starts.";
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

/** PATCH /sessions/{key} body for the chosen mode — only the fields the user changed, so an
 * edit never overwrites values (like a split segment's end) it didn't touch. */
export function sessionEditPayload(v: ClassFormValue, mode: ClassFormMode, initial?: ClassFormValue) {
  const all: Record<string, unknown> =
    mode === "edit-this"
      ? { startTime: v.startTime, endTime: v.endTime, location: v.location.trim() || null }
      : {
          title: v.title.trim() || null,
          startTime: v.startTime,
          endTime: v.endTime,
          location: v.location.trim() || null,
          color: v.color,
          links: v.links.map((l) => ({ label: l.label.trim() || null, url: l.url })),
          recurrence: recurrencePayload(v.recurrence),
        };
  if (!initial) return all;
  const before = sessionEditPayload(initial, mode) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(all).filter(([k, val]) => JSON.stringify(val) !== JSON.stringify(before[k])));
}

export function classPayload(v: ClassFormValue) {
  return {
    course: courseRef(v.hierarchy),
    title: v.title.trim() || null,
    startDate: v.startDate,
    startTime: v.startTime,
    endTime: v.endTime,
    location: v.location.trim() || null,
    color: v.color,
    links: v.links.map((l) => ({ label: l.label.trim() || null, url: l.url })),
    recurrence: recurrencePayload(v.recurrence),
  };
}

const SERVER_FIELDS: [string, string][] = [
  ["/endTime", "endTime"], ["/startTime", "startTime"], ["/startDate", "startDate"],
  ["/title", "title"], ["/location", "location"],
  ["/recurrence/byWeekday", "byWeekday"], ["/recurrence/end/untilDate", "untilDate"],
  ["/recurrence/end/count", "count"], ["/recurrence/end/kind", "endKind"], ["/recurrence", "byWeekday"],
  ["/endDate", "semesterEnd"], ["/name", "course"],
];

export function serverErrors(err: ApiError): Errors {
  const e: Errors = {};
  for (const fe of err.errors) {
    const match = SERVER_FIELDS.find(([p]) => fe.field === p || fe.field.startsWith(`${p}/`));
    const linkMatch = /^\/links\/(\d+)/.exec(fe.field);
    if (linkMatch) e[`link${linkMatch[1]}`] = fe.message;
    else if (match && !e[match[1]]) e[match[1]] = fe.message;
  }
  if (Object.keys(e).length === 0) e.form = err.status === 0 ? err.title : err.title || "Couldn't save the class.";
  return e;
}

interface Props {
  initial: ClassFormValue;
  mode?: ClassFormMode;
  /** End date of the class's semester (edit modes, where the hierarchy is fixed). */
  fixedSemesterEnd?: string | null;
  submitLabel: string;
  pending: boolean;
  onSubmit: (value: ClassFormValue) => Promise<unknown>;
  onCancel: () => void;
}

export function ClassForm({ initial, mode = "create", fixedSemesterEnd, submitLabel, pending, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const pickedSemesterEnd = useSemesterEnd(value.hierarchy);
  const semesterEnd = mode === "create" ? pickedSemesterEnd : { known: true, endDate: fixedSemesterEnd ?? null };
  const semesterId = value.hierarchy.semester?.kind === "existing" ? value.hierarchy.semester.id : undefined;
  const courses = useCourses(semesterId);
  const set = (patch: Partial<ClassFormValue>) => setValue((v) => ({ ...v, ...patch }));

  // default the colour to the chosen course's colour (FR-021)
  const onHierarchy = (hierarchy: HierarchyValue) => {
    const c = hierarchy.course;
    const color = c?.kind === "existing" ? courses.data?.find((x) => x.id === c.id)?.defaultColor : undefined;
    set(color ? { hierarchy, color: color as ColorKey } : { hierarchy });
  };

  useEffect(() => {
    if (!attempt || !formRef.current) return;
    const el =
      formRef.current.querySelector<HTMLElement>("[aria-invalid='true']") ??
      formRef.current.querySelector<HTMLElement>("[role='alert']");
    el?.focus();
  }, [attempt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local = validateClassForm(value, semesterEnd, mode);
    setErrors(local);
    if (Object.keys(local).length) {
      setAttempt((a) => a + 1);
      return;
    }
    try {
      await onSubmit(value);
    } catch (err) {
      // keep every input (FR-026); show server errors next to the fields
      setErrors(isApiError(err) ? serverErrors(err) : { form: "Couldn't save the class. Please retry." });
      setAttempt((a) => a + 1);
    }
  };

  const linkErrors = Object.fromEntries(
    Object.entries(errors).filter(([k]) => k.startsWith("link")).map(([k, msg]) => [Number(k.slice(4)), msg]),
  );

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="grid gap-6">
      <FormError message={errors.form} />
      {mode === "create" && (
        <HierarchyPicker
          value={value.hierarchy}
          onChange={onHierarchy}
          errors={{ year: errors.year, semester: errors.semester, course: errors.course, semesterEnd: errors.semesterEnd }}
        />
      )}
      {mode !== "edit-this" && (
        <Field label="Title (optional)" error={errors.title} hint="For example “Lecture” or “Lab”">
          <Input maxLength={60} value={value.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
      )}
      <div className={mode === "create" ? "grid gap-4 sm:grid-cols-3" : "grid gap-4 sm:grid-cols-2"}>
        {mode === "create" && (
          <Field label="First session" error={errors.startDate}>
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
        <Input maxLength={120} value={value.location} onChange={(e) => set({ location: e.target.value })} />
      </Field>
      {mode !== "edit-this" && (
        <>
          <RecurrenceFields
            value={value.recurrence}
            onChange={(recurrence) => set({ recurrence })}
            semesterHasEnd={!semesterEnd.known || !!semesterEnd.endDate}
            errors={{ byWeekday: errors.byWeekday, untilDate: errors.untilDate, count: errors.count, endKind: errors.endKind }}
          />
          <ColorPicker value={value.color} onChange={(color) => set({ color })} />
          <LinksEditor value={value.links.slice(0, MAX_LINKS)} onChange={(links) => set({ links })} errors={linkErrors} />
        </>
      )}
      <div className="flex justify-end gap-2 border-t border-divider pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
