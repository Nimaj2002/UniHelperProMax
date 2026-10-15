import { describe, expect, it } from "vitest";
import { compareByDue, groupForList } from "@/features/tasks/model/group";

const TZ = "Europe/Istanbul";
const columns = [
  { id: "todo", countsAsDone: false },
  { id: "done", countsAsDone: true },
];

let n = 0;
const task = (over: { title?: string; dueDate?: string | null; dueTime?: string | null; columnId?: string }) => ({
  id: `t${++n}`,
  title: over.title ?? `Task ${n}`,
  dueDate: over.dueDate ?? null,
  dueTime: over.dueTime ?? null,
  columnId: over.columnId ?? "todo",
  completedAt: null,
});

const titlesOf = (groups: ReturnType<typeof groupForList>, id: string) => groups.find((g) => g.id === id)!.tasks.map((t) => t.title);

describe("groupForList", () => {
  // Thursday 15 Oct 2026, 12:00 in Istanbul (UTC+3)
  const NOW = new Date("2026-10-15T09:00:00Z");

  it("returns all six groups in order", () => {
    expect(groupForList([], columns, NOW, TZ, 1).map((g) => g.label)).toEqual([
      "Overdue",
      "Today",
      "This week",
      "Later",
      "No date",
      "Done",
    ]);
  });

  it("buckets by due date in the user's time zone and week", () => {
    const tasks = [
      task({ title: "yesterday", dueDate: "2026-10-14" }),
      task({ title: "today morning passed", dueDate: "2026-10-15", dueTime: "09:00" }),
      task({ title: "today later", dueDate: "2026-10-15", dueTime: "18:00" }),
      task({ title: "today date only", dueDate: "2026-10-15" }),
      task({ title: "sunday", dueDate: "2026-10-18" }),
      task({ title: "next monday", dueDate: "2026-10-19" }),
      task({ title: "no date" }),
      task({ title: "done overdue", dueDate: "2026-10-01", columnId: "done" }),
    ];
    const g = groupForList(tasks, columns, NOW, TZ, 1);
    expect(titlesOf(g, "overdue")).toEqual(["yesterday", "today morning passed"]);
    expect(titlesOf(g, "today")).toEqual(["today later", "today date only"]);
    expect(titlesOf(g, "thisWeek")).toEqual(["sunday"]);
    expect(titlesOf(g, "later")).toEqual(["next monday"]);
    expect(titlesOf(g, "noDate")).toEqual(["no date"]);
    expect(titlesOf(g, "done")).toEqual(["done overdue"]);
  });

  it("switches day at midnight in Istanbul, not UTC", () => {
    const t = [task({ title: "16th", dueDate: "2026-10-16" })];
    // 23:59 Istanbul on the 15th (20:59 UTC): tomorrow is this week
    expect(titlesOf(groupForList(t, columns, new Date("2026-10-15T20:59:00Z"), TZ, 1), "thisWeek")).toEqual(["16th"]);
    // 00:00 Istanbul on the 16th (21:00 UTC on the 15th): today
    expect(titlesOf(groupForList(t, columns, new Date("2026-10-15T21:00:00Z"), TZ, 1), "today")).toEqual(["16th"]);
    // a date-only task is overdue only after its day ended
    expect(titlesOf(groupForList(t, columns, new Date("2026-10-16T20:59:00Z"), TZ, 1), "today")).toEqual(["16th"]);
    expect(titlesOf(groupForList(t, columns, new Date("2026-10-16T21:01:00Z"), TZ, 1), "overdue")).toEqual(["16th"]);
  });

  it("uses the week start", () => {
    const t = [task({ title: "sunday", dueDate: "2026-10-18" })];
    expect(titlesOf(groupForList(t, columns, NOW, TZ, 1), "thisWeek")).toEqual(["sunday"]);
    // weeks starting on Sunday: the 18th starts next week
    expect(titlesOf(groupForList(t, columns, NOW, TZ, 0), "later")).toEqual(["sunday"]);
  });

  it("sorts by date, then time (date-only last), then title", () => {
    const a = task({ title: "b", dueDate: "2026-10-20", dueTime: "10:00" });
    const b = task({ title: "a", dueDate: "2026-10-20", dueTime: "10:00" });
    const c = task({ title: "c", dueDate: "2026-10-20" });
    const d = task({ title: "d", dueDate: "2026-10-20", dueTime: "08:00" });
    const e = task({ title: "e", dueDate: "2026-10-19" });
    expect([a, b, c, d, e].sort(compareByDue).map((t) => t.title)).toEqual(["e", "d", "a", "b", "c"]);
  });
});
