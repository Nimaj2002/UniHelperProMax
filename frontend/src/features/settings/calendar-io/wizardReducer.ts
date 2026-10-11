/**
 * Import wizard state (feature 010, contracts/ui-import-export.md): the steps, the plan the user
 * builds on top of the preview defaults, client-side checks that mirror the server's codes, and
 * the `ImportPlan` sent on confirm. The server stays authoritative; these checks only keep the
 * confirm button honest and name the first problem.
 */
import type { ColorKey } from "@/lib/palette";
import type { ImportGroup, ImportPlan, ImportPreview, ImportResult } from "./api";

export type Step = "choose" | "reading" | "preview" | "importing" | "result";
export type Kind = "class" | "event";

export type CourseChoice = { kind: "auto" } | { kind: "existing"; id: string } | { kind: "new"; name: string };

export interface GroupState {
  selected: boolean;
  importAs: Kind;
  course: CourseChoice;
  semester: "saved" | "destination";
  endDate?: string;
  unsupported?: "first_only" | "skip";
  title: string;
}

export type Destination =
  | { mode: "existing"; semesterId?: string }
  | { mode: "new"; yearId?: string; yearName: string; name: string };

export interface CourseLite {
  id: string;
  name: string;
  defaultColor: string;
}

export interface WizardState {
  step: Step;
  fileName?: string;
  percent: number;
  checking: boolean;
  preview?: ImportPreview;
  groups: Record<string, GroupState>;
  destination: Destination;
  result?: ImportResult;
  error?: string;
}

export type Action =
  | { type: "start"; fileName: string }
  | { type: "progress"; percent: number }
  | { type: "checking" }
  | { type: "loaded"; preview: ImportPreview; semesterId?: string }
  | { type: "failed"; message: string }
  | { type: "reset" }
  | { type: "toggle"; groupId: string; selected: boolean }
  | { type: "selectAll"; selected: boolean }
  | { type: "setType"; groupId: string; importAs: Kind }
  | { type: "setCourse"; groupId: string; course: CourseChoice }
  | { type: "setSemester"; groupId: string; semester: "saved" | "destination" }
  | { type: "setEndDate"; groupId: string; endDate: string }
  | { type: "setUnsupported"; groupId: string; choice: "first_only" | "skip" }
  | { type: "setTitle"; groupId: string; title: string }
  | { type: "setDestination"; destination: Destination }
  | { type: "importing" }
  | { type: "imported"; result: ImportResult }
  | { type: "importFailed"; message: string };

export const initialState: WizardState = {
  step: "choose",
  percent: 0,
  checking: false,
  groups: {},
  destination: { mode: "existing" },
};

export function defaultsFor(group: ImportGroup): GroupState {
  return {
    selected: group.defaults.selected,
    importAs: group.defaults.importAs,
    course: { kind: "auto" },
    semester: "saved",
    endDate: group.openEnded?.suggestedEndDate,
    title: "",
  };
}

function patch(state: WizardState, groupId: string, change: Partial<GroupState>): WizardState {
  const current = state.groups[groupId];
  if (!current) return state;
  return { ...state, error: undefined, groups: { ...state.groups, [groupId]: { ...current, ...change } } };
}

export function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "start":
      return { ...initialState, destination: state.destination, step: "reading", fileName: action.fileName };
    case "progress":
      return { ...state, percent: Math.max(0, Math.min(100, Math.round(action.percent))) };
    case "checking":
      return { ...state, percent: 100, checking: true };
    case "loaded": {
      const groups = Object.fromEntries(action.preview.groups.map((g) => [g.groupId, defaultsFor(g)]));
      const destination: Destination =
        state.destination.mode === "existing" && !state.destination.semesterId
          ? { mode: "existing", semesterId: action.semesterId }
          : state.destination;
      return { ...state, step: "preview", checking: false, preview: action.preview, groups, destination, error: undefined };
    }
    case "failed":
      return { ...initialState, destination: state.destination, error: action.message };
    case "reset":
      return { ...initialState, destination: state.destination };
    case "toggle":
      return patch(state, action.groupId, { selected: action.selected });
    case "selectAll":
      return {
        ...state,
        error: undefined,
        groups: Object.fromEntries(Object.entries(state.groups).map(([id, g]) => [id, { ...g, selected: action.selected }])),
      };
    case "setType":
      return patch(state, action.groupId, { importAs: action.importAs });
    case "setCourse":
      return patch(state, action.groupId, { course: action.course });
    case "setSemester":
      return patch(state, action.groupId, { semester: action.semester, course: { kind: "auto" } });
    case "setEndDate":
      return patch(state, action.groupId, { endDate: action.endDate });
    case "setUnsupported":
      return patch(state, action.groupId, { unsupported: action.choice });
    case "setTitle":
      return patch(state, action.groupId, { title: action.title });
    case "setDestination": {
      // a new destination means new course matches: automatic mappings follow it
      const groups = Object.fromEntries(
        Object.entries(state.groups).map(([id, g]) => [id, g.course.kind === "existing" ? { ...g, course: { kind: "auto" as const } } : g]),
      );
      return { ...state, destination: action.destination, groups, error: undefined };
    }
    case "importing":
      return { ...state, step: "importing", error: undefined };
    case "imported":
      return { ...state, step: "result", result: action.result };
    case "importFailed":
      return { ...state, step: "preview", error: action.message };
  }
}

// ---- courses ------------------------------------------------------------------------------

/** The server's `name_key` for matching: surrounding spaces and case ignored. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function isReservedName(name: string): boolean {
  return nameKey(name).replace(/[.\s]+$/, "") === "_events";
}

/** Whether a group goes to its saved semester (a file exported by this app) or the destination. */
export function usesSaved(group: ImportGroup, gs: GroupState): boolean {
  return !!group.saved && gs.semester === "saved";
}

export type CourseTarget = { kind: "existing"; course: CourseLite } | { kind: "new"; name: string };

/** The course a Class group maps to, given the courses of its target semester. */
export function courseTarget(group: ImportGroup, gs: GroupState, courses: CourseLite[]): CourseTarget {
  if (gs.course.kind === "existing") {
    const id = gs.course.id;
    const course = courses.find((c) => c.id === id);
    if (course) return { kind: "existing", course };
  }
  const name =
    gs.course.kind === "new"
      ? gs.course.name
      : (usesSaved(group, gs) && group.saved?.courseName) || (group.titleMissing ? gs.title : group.title);
  const match = courses.find((c) => nameKey(c.name) === nameKey(name));
  return match ? { kind: "existing", course: match } : { kind: "new", name };
}

const COURSE_COLOR_ORDER: ColorKey[] = [
  "blue", "green", "orange", "violet", "red", "teal", "pink", "amber", "indigo", "cyan", "lime", "slate",
];

/** The colours new courses will get, in group order (same rule as the server, R12). */
export function predictColors(names: string[], existing: string[]): Record<string, ColorKey> {
  const used = [...existing];
  const out: Record<string, ColorKey> = {};
  for (const name of names) {
    const key = nameKey(name);
    if (out[key]) continue;
    const counts = new Map<string, number>();
    for (const c of used) counts.set(c, (counts.get(c) ?? 0) + 1);
    const free = COURSE_COLOR_ORDER.find((c) => !counts.get(c));
    const color =
      free ?? [...COURSE_COLOR_ORDER].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || COURSE_COLOR_ORDER.indexOf(a) - COURSE_COLOR_ORDER.indexOf(b))[0];
    out[key] = color;
    used.push(color);
  }
  return out;
}

// ---- validation and the plan ------------------------------------------------------------

export interface Problem {
  groupId?: string;
  field: "destination" | "selection" | "unsupported" | "title" | "course" | "endDate";
  message: string;
}

export function validate(state: WizardState, coursesFor: (group: ImportGroup, gs: GroupState) => CourseLite[]): Problem | undefined {
  const preview = state.preview;
  if (!preview) return { field: "selection", message: "Choose a file first." };
  const selected = preview.groups.filter((g) => state.groups[g.groupId]?.selected);
  if (selected.length === 0) return { field: "selection", message: "Select at least one group to import." };
  const needsDestination = selected.some((g) => !usesSaved(g, state.groups[g.groupId]));
  const d = state.destination;
  if (needsDestination) {
    if (d.mode === "existing" && !d.semesterId) return { field: "destination", message: "Choose the semester to import into." };
    if (d.mode === "new" && !d.name.trim()) return { field: "destination", message: "Name the new semester." };
    if (d.mode === "new" && !d.yearId && !d.yearName.trim()) return { field: "destination", message: "Choose or name the year." };
  }
  for (const g of selected) {
    const gs = state.groups[g.groupId];
    if (g.unsupported && !gs.unsupported)
      return { groupId: g.groupId, field: "unsupported", message: `${g.title}: choose what to do with this repetition.` };
    if (gs.endDate && g.firstDate && gs.endDate < g.firstDate)
      return { groupId: g.groupId, field: "endDate", message: `${g.title}: the end date is before the first entry.` };
    if (gs.importAs === "event") {
      if (g.titleMissing && !gs.title.trim()) return { groupId: g.groupId, field: "title", message: "Enter a title for the untitled entries." };
    } else {
      const target = courseTarget(g, gs, coursesFor(g, gs));
      if (target.kind === "new" && !target.name.trim())
        return { groupId: g.groupId, field: "course", message: "Choose or name a course for the untitled entries." };
      if (target.kind === "new" && isReservedName(target.name))
        return { groupId: g.groupId, field: "course", message: `${g.title}: this name is reserved for events.` };
    }
  }
  return undefined;
}

export function toPlan(state: WizardState): ImportPlan {
  const preview = state.preview;
  const d = state.destination;
  const destination: ImportPlan["destination"] =
    d.mode === "existing"
      ? { id: d.semesterId ?? "" }
      : { new: { name: d.name.trim(), year: d.yearId ? { id: d.yearId } : { new: { name: d.yearName.trim() } } } };
  const groups = (preview?.groups ?? []).map((g) => {
    const gs = state.groups[g.groupId];
    const item: ImportPlan["groups"][number] = { groupId: g.groupId, selected: gs.selected, importAs: gs.importAs, semester: gs.semester };
    if (gs.importAs === "class" && gs.course.kind === "existing") item.course = { existing: gs.course.id };
    if (gs.importAs === "class" && gs.course.kind === "new") item.course = { new: gs.course.name.trim() };
    if (gs.importAs === "class" && gs.course.kind === "auto" && g.titleMissing && gs.title.trim()) item.course = { new: gs.title.trim() };
    if (g.titleMissing && gs.title.trim()) item.title = gs.title.trim();
    if (g.openEnded && gs.endDate) item.endDate = gs.endDate;
    if (g.unsupported && gs.unsupported) item.unsupported = gs.unsupported;
    return item;
  });
  return { destination, groups };
}

export function selectedCount(state: WizardState): number {
  return (state.preview?.groups ?? []).reduce((n, g) => n + (state.groups[g.groupId]?.selected ? g.occurrenceCount : 0), 0);
}
