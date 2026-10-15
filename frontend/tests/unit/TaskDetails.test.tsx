import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { Task, TaskDetail } from "@/features/tasks/api";
import { TaskDetails, UNSAVED_TITLE } from "@/features/tasks/TaskDetails";
import { json, mockFetch, on, renderWithProviders, type Handler } from "./test-utils";

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  toastMock.mockClear();
  toastMock.error.mockClear();
  localStorage.clear();
});

const COLUMNS = [
  { id: "todo", name: "To do", position: 0, countsAsDone: false, version: 1 },
  { id: "done", name: "Done", position: 1, countsAsDone: true, version: 1 },
];

let seq = 0;
function detail(over: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: `task-${++seq}`, columnId: "todo", position: 0, title: "Read ch. 4", description: "", dueDate: null, dueTime: null,
    courseId: null, courseName: null, courseColor: null, event: null, completedAt: null, previousColumnId: null,
    checklistDone: 0, checklistTotal: 0, quickNoteCount: 0, version: 1, createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z", checklist: [], ...over,
  };
}

function setup(task: TaskDetail, ...extra: Handler[]) {
  const base = `/api/v1/tasks/${task.id}`;
  const api = mockFetch(
    ...extra,
    on("GET", base, () => json(task)),
    on("GET", "/api/v1/tasks", () => json([task as Task])),
    on("GET", "/api/v1/task-columns", () => json(COLUMNS)),
    on("GET", `${base}/quick-notes`, () => json([])),
    on("GET", "/api/v1/course-tree", () => json([])),
    on("GET", "/api/v1/auth/me", () => json({ id: "u1", username: "u", timezone: "Europe/Istanbul" })),
  );
  const onClose = vi.fn();
  const utils = renderWithProviders(<TaskDetails taskId={task.id} onClose={onClose} onQuickNotes={vi.fn()} />);
  return { api, onClose, user: userEvent.setup(), ...utils };
}

const saveState = () => screen.getByTestId("task-save-state");

describe("TaskDetails (012 US3)", () => {
  it("autosaves a description: Saving… then Saved, and is axe clean", async () => {
    const task = detail();
    let patched: unknown;
    const { api, user, container } = setup(
      task,
      on("PATCH", `/api/v1/tasks/${task.id}`, (_u, init) => {
        patched = JSON.parse(String(init.body));
        return json({ ...task, description: "Notes", version: 2 });
      }),
    );
    const description = await screen.findByLabelText("Description");
    expect(screen.getByRole("dialog", { name: "Read ch. 4" })).toHaveAttribute("aria-modal", "false");
    expect(saveState()).toHaveTextContent("Saved");
    await user.type(description, "Notes");
    expect(saveState()).toHaveTextContent("Saving…");
    await waitFor(() => expect(saveState()).toHaveTextContent("Saved"), { timeout: 4000 });
    expect(patched).toEqual({ description: "Notes" });
    expect(api.calls.filter((c) => c.init.method === "PATCH")).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a failed save keeps the text and warns on close; Retry saves and closes", async () => {
    const task = detail();
    let online = false;
    const { user, onClose } = setup(
      task,
      on("PATCH", `/api/v1/tasks/${task.id}`, () => {
        if (!online) throw new TypeError("Failed to fetch");
        return json({ ...task, description: "Keep me", version: 2 });
      }),
    );
    const description = await screen.findByLabelText("Description");
    await user.type(description, "Keep me");
    await waitFor(() => expect(saveState()).toHaveTextContent("Couldn't save — Retry"), { timeout: 4000 });
    expect(description).toHaveValue("Keep me");

    await user.click(screen.getByRole("button", { name: "Back to tasks" }));
    const alert = await screen.findByRole("alertdialog", { name: UNSAVED_TITLE });
    await user.click(within(alert).getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(description).toHaveValue("Keep me");

    // Escape asks too; this time retry with the network back
    await user.click(description);
    await user.keyboard("{Escape}");
    const again = await screen.findByRole("alertdialog", { name: UNSAVED_TITLE });
    online = true;
    await user.click(within(again).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("delete shows an Undo toast that restores the task", async () => {
    const task = detail();
    const { api, user, onClose } = setup(
      task,
      on("DELETE", `/api/v1/tasks/${task.id}`, () => new Response(null, { status: 204 })),
      on("POST", `/api/v1/tasks/${task.id}/restore`, () => json(task)),
    );
    await user.click(await screen.findByRole("button", { name: "Delete task" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [message, options] = toastMock.mock.calls.at(-1)!;
    expect(message).toBe("Task deleted");
    expect(options.duration).toBeGreaterThanOrEqual(10_000);
    expect(options.action.label).toBe("Undo");
    options.action.onClick();
    await waitFor(() => expect(api.calls.some((c) => c.init.method === "POST" && c.url.pathname.endsWith("/restore"))).toBe(true));
  });

  it("a linked task shows title and due read-only with Edit event", async () => {
    const task = detail({
      title: "AI Seminar",
      dueDate: "2026-10-20",
      dueTime: "14:00",
      event: { sessionKey: "E1:2026-10-20", title: "AI Seminar", date: "2026-10-20" },
    });
    setup(task);
    expect(await screen.findByTestId("linked-title")).toHaveTextContent("AI Seminar");
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.queryByLabelText("Due date")).toBeNull();
    expect(screen.getByRole("link", { name: "Edit event" })).toHaveAttribute("href", "/sessions/E1%3A2026-10-20/edit");
    expect(screen.getByRole("link", { name: "Open note" })).toHaveAttribute("href", "/workspace/E1%3A2026-10-20");
  });
});
