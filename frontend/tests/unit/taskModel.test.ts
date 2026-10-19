/** 012 R2 / R9: board order and due-date rules (fixed clock, Europe/Istanbul = UTC+3). */
import { describe, expect, it } from "vitest";
import { openCount, overdueCount, formatCount } from "@/features/tasks/model/counts";
import { dueBucket, dueLabel, isDone, isOverdue } from "@/features/tasks/model/dates";
import { applyMove, tasksByColumn } from "@/features/tasks/model/order";
import type { ColumnLike, TaskLike } from "@/features/tasks/model/types";

const TZ = "Europe/Istanbul";
const COLUMNS: ColumnLike[] = [
  { id: "todo", name: "To do", position: 0, countsAsDone: false },
  { id: "doing", name: "In progress", position: 1, countsAsDone: false },
  { id: "done", name: "Done", position: 2, countsAsDone: true },
];

function task(id: string, columnId: string, position: number, extra: Partial<TaskLike> = {}): TaskLike {
  return { id, columnId, position, title: id, dueDate: null, dueTime: null, courseId: null, event: null, completedAt: null, previousColumnId: null, ...extra };
}

const order = (tasks: TaskLike[], col: string) => tasksByColumn(tasks, COLUMNS).find((g) => g.column.id === col)!.tasks.map((t) => `${t.id}${t.position}`);

describe("applyMove", () => {
  const board = [task("a", "todo", 0), task("b", "todo", 1), task("c", "todo", 2), task("x", "doing", 0)];

  it("moves within a column and renumbers", () => {
    const r = applyMove(board, "c", "todo", 0);
    expect(order(r, "todo")).toEqual(["c0", "a1", "b2"]);
    expect(board[2].position).toBe(2); // input untouched
  });

  it("moves across columns, renumbering both", () => {
    const r = applyMove(board, "a", "doing", 1);
    expect(order(r, "todo")).toEqual(["b0", "c1"]);
    expect(order(r, "doing")).toEqual(["x0", "a1"]);
  });

  it("clamps the index to the end of the target column", () => {
    expect(order(applyMove(board, "a", "doing", 99), "doing")).toEqual(["x0", "a1"]);
    expect(order(applyMove(board, "a", "todo", 99), "todo")).toEqual(["b0", "c1", "a2"]);
    expect(order(applyMove(board, "a", "doing", -3), "doing")).toEqual(["a0", "x1"]);
  });

  it("leaves the list unchanged for an unknown task", () => {
    expect(applyMove(board, "nope", "todo", 0)).toEqual(board);
  });

  it("records and clears completion with columns, like the server", () => {
    const now = new Date("2026-10-15T09:00:00Z");
    const done = applyMove(board, "a", "done", 0, COLUMNS, now).find((t) => t.id === "a")!;
    expect(done.completedAt).toBe(now.toISOString());
    expect(done.previousColumnId).toBe("todo");
    const back = applyMove([...board.filter((t) => t.id !== "a"), done], "a", "doing", 0, COLUMNS, now).find((t) => t.id === "a")!;
    expect(back.completedAt).toBeNull();
  });

  it("groups by column in column order, unknown columns left out", () => {
    const groups = tasksByColumn([task("z", "gone", 0), ...board], [...COLUMNS].reverse());
    expect(groups.map((g) => g.column.id)).toEqual(["todo", "doing", "done"]);
    expect(groups.flatMap((g) => g.tasks).map((t) => t.id)).toEqual(["a", "b", "c", "x"]);
  });
});

describe("due dates in Europe/Istanbul", () => {
  // Thursday 15 October 2026, 14:00 in Istanbul
  const now = new Date("2026-10-15T11:00:00Z");

  it("date-only tasks are overdue only after the end of the due day", () => {
    expect(isOverdue(task("t", "todo", 0, { dueDate: "2026-10-15" }), now, TZ)).toBe(false);
    expect(isOverdue(task("t", "todo", 0, { dueDate: "2026-10-14" }), now, TZ)).toBe(true);
    // 23:59 on the 14th in Istanbul is still the 14th
    expect(isOverdue(task("t", "todo", 0, { dueDate: "2026-10-14" }), new Date("2026-10-14T20:59:00Z"), TZ)).toBe(false);
    expect(isOverdue(task("t", "todo", 0, { dueDate: "2026-10-14" }), new Date("2026-10-14T21:00:01Z"), TZ)).toBe(true);
  });

  it("timed tasks are overdue after their time; done and undated never", () => {
    expect(isOverdue(task("t", "todo", 0, { dueDate: "2026-10-15", dueTime: "13:59" }), now, TZ)).toBe(true);
    expect(isOverdue(task("t", "todo", 0, { dueDate: "2026-10-15", dueTime: "14:01" }), now, TZ)).toBe(false);
    expect(isOverdue(task("t", "done", 0, { dueDate: "2026-10-01" }), now, TZ, COLUMNS)).toBe(false);
    expect(isOverdue(task("t", "todo", 0, { dueDate: "2026-10-01", completedAt: "2026-10-02T00:00:00Z" }), now, TZ)).toBe(false);
    expect(isOverdue(task("t", "todo", 0), now, TZ)).toBe(false);
  });

  it("buckets: overdue, today, this week (Monday start), later, no date, done", () => {
    const b = (extra: Partial<TaskLike>, col = "todo") => dueBucket(task("t", col, 0, extra), now, TZ, 1, COLUMNS);
    expect(b({ dueDate: "2026-10-14" })).toBe("overdue");
    expect(b({ dueDate: "2026-10-15", dueTime: "09:00" })).toBe("overdue");
    expect(b({ dueDate: "2026-10-15" })).toBe("today");
    expect(b({ dueDate: "2026-10-15", dueTime: "18:00" })).toBe("today");
    expect(b({ dueDate: "2026-10-18" })).toBe("thisWeek"); // Sunday
    expect(b({ dueDate: "2026-10-19" })).toBe("later"); // next Monday
    expect(b({})).toBe("noDate");
    expect(b({ dueDate: "2026-10-01" }, "done")).toBe("done");
    // a Sunday week start ends the week on Saturday
    expect(dueBucket(task("t", "todo", 0, { dueDate: "2026-10-18" }), now, TZ, 0, COLUMNS)).toBe("later");
  });

  it("today is the user's day, not UTC's", () => {
    // 01:30 on the 16th in Istanbul is still the 15th in UTC
    const late = new Date("2026-10-15T22:30:00Z");
    expect(dueBucket(task("t", "todo", 0, { dueDate: "2026-10-16" }), late, TZ, 1, COLUMNS)).toBe("today");
  });

  it("labels", () => {
    expect(dueLabel(task("t", "todo", 0, { dueDate: "2026-10-15" }), now, TZ)).toBe("Today");
    expect(dueLabel(task("t", "todo", 0, { dueDate: "2026-10-12" }), now, TZ)).toBe("Overdue");
    expect(dueLabel(task("t", "todo", 0, { dueDate: "2026-10-20" }), now, TZ)).toBe("Tue 20 Oct");
    expect(dueLabel(task("t", "todo", 0, { dueDate: "2027-01-04" }), now, TZ)).toBe("Mon 4 Jan 2027");
    expect(dueLabel(task("t", "todo", 0), now, TZ)).toBeNull();
  });

  it("rail counts", () => {
    const tasks = [
      task("a", "todo", 0, { dueDate: "2026-10-14" }),
      task("b", "doing", 0, { dueDate: "2026-10-15", dueTime: "10:00" }),
      task("c", "doing", 1, { dueDate: "2026-10-20" }),
      task("d", "done", 0, { dueDate: "2026-10-01" }),
    ];
    expect(isDone(tasks[3], COLUMNS)).toBe(true);
    expect(openCount(tasks, COLUMNS)).toBe(3);
    expect(overdueCount(tasks, COLUMNS, now, TZ)).toBe(2);
    expect(formatCount(100)).toBe("99+");
  });
});
