import { describe, expect, it } from "vitest";
import { announcement, keyboardMove } from "@/features/tasks/board/keyboardMove";

const layout = [
  { id: "todo", taskIds: ["a", "b", "c", "d", "e"] },
  { id: "doing", taskIds: ["f", "g"] },
  { id: "done", taskIds: [] },
];
const columns = [
  { id: "todo", name: "To do" },
  { id: "doing", name: "In progress" },
  { id: "done", name: "Done" },
];
const tasks = [{ id: "b", title: "Read ch. 4" }];

const picked = keyboardMove(null, { type: "pickUp", taskId: "b", layout })!;

describe("keyboardMove", () => {
  it("picks up at the card's own place", () => {
    expect(picked).toEqual({ taskId: "b", origin: { columnId: "todo", index: 1 }, target: { columnId: "todo", index: 1 } });
    expect(keyboardMove(null, { type: "pickUp", taskId: "zzz", layout })).toBeNull();
  });
  it("moves up and down within the column, clamped", () => {
    const up = keyboardMove(picked, { type: "up", layout })!;
    expect(up.target.index).toBe(0);
    expect(keyboardMove(up, { type: "up", layout })).toBe(up);
    let s = picked;
    for (let i = 0; i < 10; i++) s = keyboardMove(s, { type: "down", layout })!;
    expect(s.target).toEqual({ columnId: "todo", index: 4 });
  });
  it("moves to neighbouring columns at min(index, length)", () => {
    let s = keyboardMove(picked, { type: "down", layout });
    s = keyboardMove(s, { type: "down", layout })!; // index 3
    const right = keyboardMove(s, { type: "right", layout })!;
    expect(right.target).toEqual({ columnId: "doing", index: 2 });
    const done = keyboardMove(right, { type: "right", layout })!;
    expect(done.target).toEqual({ columnId: "done", index: 0 });
    expect(keyboardMove(done, { type: "right", layout })).toBe(done);
    expect(keyboardMove(picked, { type: "left", layout })).toBe(picked);
    const back = keyboardMove(right, { type: "left", layout })!;
    expect(back.target).toEqual({ columnId: "todo", index: 2 });
    expect(back.origin).toEqual(picked.origin);
  });
  it("drop and cancel end the move; actions without a move do nothing", () => {
    expect(keyboardMove(picked, { type: "drop" })).toBeNull();
    expect(keyboardMove(picked, { type: "cancel" })).toBeNull();
    expect(keyboardMove(null, { type: "down", layout })).toBeNull();
  });
});

describe("announcement", () => {
  it("describes each step", () => {
    expect(announcement("pickUp", picked, columns, tasks, layout)).toBe("Picked up Read ch. 4. Position 2 of 5 in To do.");
    const right = keyboardMove(keyboardMove(picked, { type: "up", layout }), { type: "right", layout });
    expect(announcement("right", right, columns, tasks, layout)).toBe("Moved to In progress, position 1 of 3.");
    expect(announcement("drop", right, columns, tasks, layout)).toBe("Dropped in In progress, position 1 of 3.");
    expect(announcement("cancel", right, columns, tasks, layout)).toBe("Move cancelled.");
  });
});
