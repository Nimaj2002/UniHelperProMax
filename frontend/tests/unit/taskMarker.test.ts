import { describe, expect, it } from "vitest";
import { markerTarget } from "@/features/tasks/calendar/TaskMarker";
import type { TaskColumn } from "@/features/tasks/api";

const col = (id: string, position: number, countsAsDone = false): TaskColumn =>
  ({ id, name: id, position, countsAsDone, taskCount: 0, version: 1 });

describe("calendar marker tick / untick target (FR-049)", () => {
  const columns = [col("done", 2, true), col("todo", 0), col("doing", 1)];

  it("ticks to the first column that counts as done", () => {
    expect(markerTarget({ columnId: "doing", previousColumnId: null }, false, columns)).toBe("done");
    expect(markerTarget({ columnId: "todo", previousColumnId: null }, false, [col("todo", 0)])).toBeNull();
  });

  it("unticks to the previous column, else the first not-done column", () => {
    expect(markerTarget({ columnId: "done", previousColumnId: "doing" }, true, columns)).toBe("doing");
    expect(markerTarget({ columnId: "done", previousColumnId: "gone" }, true, columns)).toBe("todo");
    expect(markerTarget({ columnId: "done", previousColumnId: "done" }, true, columns)).toBe("todo");
  });
});
