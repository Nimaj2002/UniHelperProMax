import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applyFilters,
  hiddenCount,
  NO_FILTERS,
  parseFilters,
  PERSONAL,
} from "@/features/tasks/model/filters";

const columns = [
  { id: "todo", countsAsDone: false },
  { id: "done", countsAsDone: true },
];
const event = { sessionKey: "e:2026-10-15", title: "Seminar", date: "2026-10-15" };
const tasks = [
  { id: "1", title: "Read chapter 4", courseId: "algo", event: null, columnId: "todo" },
  { id: "2", title: "Buy milk", courseId: null, event: null, columnId: "todo" },
  { id: "3", title: "Seminar", courseId: null, event, columnId: "todo" },
  { id: "4", title: "Ödev teslimi — Şubat", courseId: "algo", event: null, columnId: "done" },
];
const ids = (f: Partial<typeof NO_FILTERS>) => applyFilters(tasks, { ...NO_FILTERS, ...f }, columns).map((t) => t.id);

describe("task filters", () => {
  it("no filters shows everything", () => {
    expect(ids({})).toEqual(["1", "2", "3", "4"]);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it("course, personal, event-linked, show done and search", () => {
    expect(ids({ course: "algo" })).toEqual(["1", "4"]);
    expect(ids({ course: PERSONAL })).toEqual(["2", "3"]);
    expect(ids({ eventLinked: true })).toEqual(["3"]);
    expect(ids({ showDone: false })).toEqual(["1", "2", "3"]);
    expect(ids({ search: "  CHAPTER " })).toEqual(["1"]);
    // diacritics and case are ignored (Turkish titles)
    expect(ids({ search: "odev" })).toEqual(["4"]);
    expect(ids({ search: "şubat" })).toEqual(["4"]);
    expect(ids({ course: "algo", showDone: false })).toEqual(["1"]);
  });

  it("counts active filters (a non-empty search counts) and hidden tasks", () => {
    expect(activeFilterCount({ ...NO_FILTERS, search: " " })).toBe(0);
    expect(activeFilterCount({ course: PERSONAL, eventLinked: true, search: "x", showDone: false })).toBe(4);
    expect(hiddenCount(tasks, { ...NO_FILTERS, course: PERSONAL }, columns)).toBe(2);
    expect(hiddenCount(tasks, NO_FILTERS, columns)).toBe(0);
  });

  it("parses stored values safely", () => {
    expect(parseFilters(null)).toEqual(NO_FILTERS);
    expect(parseFilters({ course: 3, eventLinked: "yes", search: 1, showDone: false })).toEqual({ ...NO_FILTERS, showDone: false });
    expect(parseFilters({ course: "algo", eventLinked: true, search: "x", showDone: true })).toEqual({
      course: "algo",
      eventLinked: true,
      search: "x",
      showDone: true,
    });
  });
});
