/**
 * The quick form's values and rules (009 US6, research R12), kept pure for tests. A saved quick
 * entry is built through the full forms' own value types and payload functions (`classPayload`,
 * `eventPayload`), so it is identical to one made with "New class" / "New event" (FR-041).
 */
import type { Pick as Choice } from "@/components/form/CreatableCombobox";
import { initialClassForm, type ClassFormValue } from "@/features/classes/ClassForm";
import { emptyHierarchy, type HierarchyValue } from "@/features/classes/HierarchyPicker";
import { isValidUrl, type LinkValue } from "@/features/classes/LinksEditor";
import { defaultRecurrence, WEEKDAYS, type RecurrenceValue, type WeekdayCode } from "@/features/classes/RecurrenceFields";
import { initialEventForm, type EventFormValue } from "@/features/events/EventForm";
import type { YearNode } from "@/features/courses/api";
import { fromISODate, parseTimeHHmm } from "@/lib/dates";
import type { ColorKey } from "@/lib/palette";
import { timeValue, type Draft } from "./draft";

export type QuickType = "class" | "event";
export type RepeatChoice = "none" | "weekly";

export interface QuickValue {
  type: QuickType;
  /** Class: an existing course or a new name (then `hierarchy` year/semester are required). */
  course: Choice;
  /** Event: its title. */
  title: string;
  /** Year and semester: the event's, or the new course's. */
  hierarchy: HierarchyValue;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  links: LinkValue[];
  repeat: RepeatChoice;
}

export function initialQuickValue(draft: Pick<Draft, "date" | "startMin" | "endMin">, type: QuickType, hierarchy: HierarchyValue = emptyHierarchy): QuickValue {
  return {
    type,
    course: null,
    title: "",
    hierarchy: { ...hierarchy, course: null },
    date: draft.date,
    startTime: timeValue(draft.startMin),
    endTime: timeValue(draft.endMin),
    location: "",
    links: [],
    repeat: "none",
  };
}

/** Something was entered (FR-039): any field other than the type switch differs from the
 * values the form opened with. */
export function isDirty(v: QuickValue, initial: QuickValue): boolean {
  return JSON.stringify({ ...v, type: null }) !== JSON.stringify({ ...initial, type: null });
}

export function weekdayOf(date: string): { code: WeekdayCode; name: string } {
  const monday0 = (fromISODate(date).getDay() + 6) % 7;
  const [code, , name] = WEEKDAYS[monday0];
  return { code, name };
}

export const END_AFTER_START = "End must be after start";

export type QuickErrors = Partial<Record<"course" | "title" | "year" | "semester" | "date" | "startTime" | "endTime" | "location" | "repeat" | `link${number}`, string>>;

/** Inline problems; Save is enabled only when there are none (FR-035). `semesterEnd` is the
 * chosen semester's end, needed by "Weekly" (it ends with the semester, like the full form). */
export function validateQuick(v: QuickValue, semesterEnd: { known: boolean; endDate: string | null }): QuickErrors {
  const e: QuickErrors = {};
  const needsSemester = v.type === "event" || v.course?.kind === "new";
  if (v.type === "class" && !v.course) e.course = "Choose or create a course.";
  if (v.type === "event") {
    const title = v.title.trim();
    if (!title) e.title = "Enter a title.";
    else if (title.length > 120) e.title = "Use at most 120 characters.";
  }
  if (needsSemester) {
    if (!v.hierarchy.year) e.year = "Choose or create a year.";
    if (!v.hierarchy.semester) e.semester = "Choose or create a semester.";
  }
  if (!v.date) e.date = "Choose the date.";
  if (!v.startTime) e.startTime = "Choose a start time.";
  if (!v.endTime) e.endTime = "Choose an end time.";
  else if (v.startTime && parseTimeHHmm(v.endTime) <= parseTimeHHmm(v.startTime)) e.endTime = END_AFTER_START;
  const maxLocation = v.type === "event" ? 200 : 120;
  if (v.location.length > maxLocation) e.location = `Use at most ${maxLocation} characters.`;
  v.links.forEach((l, i) => {
    if (!isValidUrl(l.url)) e[`link${i}`] = "Enter a full web address starting with http:// or https://";
  });
  if (v.repeat === "weekly" && semesterEnd.known && !semesterEnd.endDate)
    e.repeat = "This semester has no end date. Choose “Custom…” to end the repetition another way.";
  return e;
}

/** Where an existing course lives, and its colour (the full form defaults to it, FR-021). */
export interface CourseInfo {
  id: string;
  name: string;
  label: string;
  yearId: string;
  yearName: string;
  semesterId: string;
  semesterName: string;
  color: ColorKey;
}

/** Every course for the course picker, the preselected semester's first. Labels name the
 * semester, so courses with the same name in different semesters stay apart. */
export function courseOptions(tree: YearNode[], firstSemesterId?: string | null): CourseInfo[] {
  const all: CourseInfo[] = [];
  for (const y of tree)
    for (const s of y.semesters)
      for (const c of s.courses)
        all.push({
          id: c.id,
          name: c.name,
          label: `${c.name} · ${s.semester.name} ${y.year.name}`,
          yearId: y.year.id,
          yearName: y.year.name,
          semesterId: s.semester.id,
          semesterName: s.semester.name,
          color: c.defaultColor as ColorKey,
        });
  return [...all.filter((c) => c.semesterId === firstSemesterId), ...all.filter((c) => c.semesterId !== firstSemesterId)];
}

function recurrenceOf(v: QuickValue, repeat: RepeatChoice): RecurrenceValue {
  if (repeat === "none") return { ...defaultRecurrence, freq: "none" };
  return { ...defaultRecurrence, freq: "weekly", byWeekday: v.date ? [weekdayOf(v.date).code] : [] };
}

/** The full class form's value for these entries ("More options", Save). */
export function toClassForm(v: QuickValue, courses: CourseInfo[], repeat: RepeatChoice = v.repeat): ClassFormValue {
  const base = initialClassForm({ date: v.date, start: v.startTime, end: v.endTime });
  const course = v.course;
  const picked = course?.kind === "existing" ? courses.find((c) => c.id === course.id) : undefined;
  const hierarchy: HierarchyValue = picked
    ? {
        ...emptyHierarchy,
        year: { kind: "existing", id: picked.yearId, name: picked.yearName },
        semester: { kind: "existing", id: picked.semesterId, name: picked.semesterName },
        course: { kind: "existing", id: picked.id, name: picked.name },
      }
    : { ...v.hierarchy, course: v.course };
  return {
    ...base,
    hierarchy,
    location: v.location,
    links: v.links,
    color: picked?.color ?? base.color,
    recurrence: recurrenceOf(v, repeat),
  };
}

/** The full event form's value for these entries. */
export function toEventForm(v: QuickValue, repeat: RepeatChoice = v.repeat): EventFormValue {
  return initialEventForm({
    title: v.title,
    hierarchy: { ...v.hierarchy, course: null },
    startDate: v.date,
    startTime: v.startTime,
    endTime: v.endTime,
    location: v.location,
    links: v.links,
    recurrence: recurrenceOf(v, repeat),
  });
}
