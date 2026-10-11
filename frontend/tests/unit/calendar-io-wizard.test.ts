import { describe, expect, it } from "vitest";
import type { ImportGroup, ImportPreview } from "@/features/settings/calendar-io/api";
import { groupSummary } from "@/features/settings/calendar-io/GroupTable";
import {
  courseTarget,
  initialState,
  isReservedName,
  nameKey,
  predictColors,
  reducer,
  selectedCount,
  toPlan,
  validate,
  type CourseLite,
  type WizardState,
} from "@/features/settings/calendar-io/wizardReducer";

function group(over: Partial<ImportGroup> = {}): ImportGroup {
  return {
    groupId: "g1",
    title: "Linear Algebra",
    titleMissing: false,
    occurrenceCount: 27,
    patterns: [{ weekdays: ["MO", "WE"], startTime: "10:00", endTime: "11:30" }],
    location: "FENS G032",
    repeating: true,
    unsupported: null,
    openEnded: null,
    firstDate: "2026-09-28",
    saved: null,
    defaults: { selected: true, importAs: "class", color: null },
    matches: { create: 27, update: 0, unchanged: 0, skip: 0 },
    issues: [],
    notes: [],
    skipped: [],
    ...over,
  };
}

function preview(groups: ImportGroup[]): ImportPreview {
  return {
    uploadId: "u1",
    fileName: "google.ics",
    eventCount: 40,
    timezone: "Europe/Istanbul",
    fromThisApp: false,
    groups,
    skipped: [],
    expiresAt: "2026-10-12T10:00:00+00:00",
  };
}

const LA: CourseLite = { id: "c1", name: "linear algebra ", defaultColor: "teal" };

function loaded(groups: ImportGroup[], semesterId = "s1"): WizardState {
  return reducer(reducer(initialState, { type: "start", fileName: "google.ics" }), { type: "loaded", preview: preview(groups), semesterId });
}

describe("calendar import wizard (010 US1)", () => {
  it("starts from the preview defaults and the preselected semester", () => {
    const dentist = group({ groupId: "g2", title: "Dentist", repeating: false, occurrenceCount: 1, defaults: { selected: false, importAs: "event", color: null } });
    const s = loaded([group(), dentist]);
    expect(s.step).toBe("preview");
    expect(s.groups.g1).toMatchObject({ selected: true, importAs: "class", course: { kind: "auto" } });
    expect(s.groups.g2).toMatchObject({ selected: false, importAs: "event" });
    expect(s.destination).toEqual({ mode: "existing", semesterId: "s1" });
    expect(selectedCount(s)).toBe(27);
  });

  it("matches courses by name ignoring case and spaces, else a new course", () => {
    const s = loaded([group()]);
    expect(courseTarget(group(), s.groups.g1, [LA])).toEqual({ kind: "existing", course: LA });
    expect(courseTarget(group(), s.groups.g1, [])).toEqual({ kind: "new", name: "Linear Algebra" });
    const renamed = reducer(s, { type: "setCourse", groupId: "g1", course: { kind: "new", name: "LA 101" } });
    expect(courseTarget(group(), renamed.groups.g1, [LA])).toEqual({ kind: "new", name: "LA 101" });
  });

  it("follows a destination change with the automatic mapping", () => {
    let s = loaded([group()]);
    s = reducer(s, { type: "setCourse", groupId: "g1", course: { kind: "existing", id: "c1" } });
    s = reducer(s, { type: "setDestination", destination: { mode: "existing", semesterId: "s2" } });
    expect(s.groups.g1.course).toEqual({ kind: "auto" });
  });

  it("blocks a new semester without a name, nothing selected, and unsupported groups without a choice", () => {
    const none = () => [] as CourseLite[];
    let s = loaded([group()]);
    s = reducer(s, { type: "setDestination", destination: { mode: "new", yearName: "2026", name: " " } });
    expect(validate(s, none)?.field).toBe("destination");
    s = reducer(s, { type: "setDestination", destination: { mode: "new", yearName: "2026", name: "Fall 2026" } });
    expect(validate(s, none)).toBeUndefined();
    expect(validate(reducer(s, { type: "selectAll", selected: false }), none)?.field).toBe("selection");

    let u = loaded([group({ unsupported: "it repeats monthly; only weekly repetition is supported" })]);
    expect(validate(u, none)).toMatchObject({ groupId: "g1", field: "unsupported" });
    u = reducer(u, { type: "setUnsupported", groupId: "g1", choice: "first_only" });
    expect(validate(u, none)).toBeUndefined();
  });

  it("refuses the reserved events name and asks for a title when the file has none", () => {
    const none = () => [] as CourseLite[];
    let s = loaded([group({ title: "_Events" })]);
    expect(validate(s, none)).toMatchObject({ field: "course" });
    s = loaded([group({ title: "(No title)", titleMissing: true, defaults: { selected: true, importAs: "event", color: null } })]);
    expect(validate(s, none)).toMatchObject({ field: "title" });
    s = reducer(s, { type: "setTitle", groupId: "g1", title: "Talk" });
    expect(validate(s, none)).toBeUndefined();
    expect(isReservedName(" _EVENTS. ")).toBe(true);
    expect(isReservedName("Events")).toBe(false);
  });

  it("builds the plan sent on confirm", () => {
    let s = loaded([group({ openEnded: { suggestedEndDate: "2027-01-19" } })]);
    s = reducer(s, { type: "setEndDate", groupId: "g1", endDate: "2026-12-31" });
    s = reducer(s, { type: "setCourse", groupId: "g1", course: { kind: "existing", id: "c1" } });
    expect(toPlan(s)).toEqual({
      destination: { id: "s1" },
      groups: [{ groupId: "g1", selected: true, importAs: "class", semester: "saved", course: { existing: "c1" }, endDate: "2026-12-31" }],
    });
    s = reducer(s, { type: "setDestination", destination: { mode: "new", yearName: "2027", name: "Spring" } });
    expect(toPlan(s).destination).toEqual({ new: { name: "Spring", year: { new: { name: "2027" } } } });
  });

  it("predicts new course colours like the server and summarises groups", () => {
    expect(predictColors(["Physics II", "Chemistry", "physics ii"], ["blue"])).toEqual({ "physics ii": "green", chemistry: "orange" });
    expect(nameKey("  Linear  ALGEBRA ")).toBe("linear algebra");
    expect(groupSummary(group())).toBe("27 entries · Mon, Wed 10:00–11:30 · FENS G032");
  });

  it("keeps the destination across a failed upload and a reset", () => {
    let s = reducer(initialState, { type: "setDestination", destination: { mode: "existing", semesterId: "s9" } });
    s = reducer(reducer(s, { type: "start", fileName: "x.ics" }), { type: "failed", message: "This file is empty." });
    expect(s.step).toBe("choose");
    expect(s.error).toBe("This file is empty.");
    expect(s.destination).toEqual({ mode: "existing", semesterId: "s9" });
  });
});
