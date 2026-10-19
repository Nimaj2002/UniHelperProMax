import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import type { Task } from "@/features/tasks/api";
import { TaskCard, TaskMoveHint } from "@/features/tasks/board/TaskCard";

const NOW = new Date("2026-10-15T12:00:00+03:00");
const TZ = "Europe/Istanbul";
const columns = [
  { id: "todo", countsAsDone: false },
  { id: "done", countsAsDone: true },
];

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1", columnId: "todo", position: 0, title: "Read ch. 4", description: "", dueDate: null, dueTime: null,
    courseId: "c1", courseName: "Algorithms", courseColor: "#336699", event: null, completedAt: null,
    previousColumnId: null, checklistDone: 2, checklistTotal: 5, quickNoteCount: 3, version: 1,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...over,
  } as Task;
}

const renderCard = (t: Task, pickedUp = false) =>
  render(
    <div>
      <TaskMoveHint />
      <TaskCard task={t} columns={columns} now={NOW} tz={TZ} pickedUp={pickedUp} />
    </div>,
  );

describe("TaskCard", () => {
  it("shows course, checklist, quick notes and the Today chip", async () => {
    const { container } = renderCard(task({ dueDate: "2026-10-15" }));
    expect(screen.getByRole("button", { name: "Read ch. 4" })).toBeInTheDocument();
    expect(screen.getByTestId("task-course")).toHaveTextContent("Algorithms");
    expect(screen.getByTestId("task-due")).toHaveTextContent("Today");
    expect(screen.getByTestId("task-checklist")).toHaveTextContent("2/5");
    expect(screen.getByRole("button", { name: "Quick notes (3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Read ch. 4" })).toHaveAttribute("aria-pressed", "false");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("marks overdue in text, and event-linked tasks for screen readers", async () => {
    const { container } = renderCard(
      task({ dueDate: "2026-10-14", event: { sessionKey: "l:2026-10-14", title: "Read ch. 4", date: "2026-10-14" } }),
      true,
    );
    expect(screen.getByTestId("task-due")).toHaveTextContent("Overdue");
    expect(screen.getByText("Event")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "Move Read ch. 4" })).toHaveAttribute("aria-pressed", "true");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a done task is never overdue and hides an empty checklist", () => {
    renderCard(task({ columnId: "done", dueDate: "2026-10-01", checklistTotal: 0, checklistDone: 0 }));
    expect(screen.getByTestId("task-due")).not.toHaveTextContent("Overdue");
    expect(screen.queryByTestId("task-checklist")).toBeNull();
  });
});
