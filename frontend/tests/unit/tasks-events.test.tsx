import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/features/classes/api";
import { DeleteSessionFlow } from "@/features/classes/DeleteSessionFlow";
import { ExportTasksCard } from "@/features/tasks/ExportTasksCard";
import { json, mockFetch, on, renderRoutes, renderWithProviders } from "./test-utils";

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

const EVENT: Session = {
  key: "E1:2026-10-15", kind: "event", lineageId: "E1", seriesId: null, seriesVersion: 3, courseId: null, semesterId: "s1",
  courseName: null, title: "AI Seminar", date: "2026-10-15", start: "2026-10-15T14:00:00+03:00",
  end: "2026-10-15T15:30:00+03:00", location: null, color: "blue", links: [], recurrenceSummary: "Does not repeat",
  isException: false, exceptionVersion: null, status: "upcoming", scheduled: true, taskId: "t1",
};

function renderDelete(linkedTaskCount: number) {
  const api = mockFetch(
    on("GET", /^\/api\/v1\/sessions\/E1(:|%3A)2026-10-15$/, () => json(EVENT)),
    on("GET", /^\/api\/v1\/sessions\/E1(:|%3A)2026-10-15\/deletion-impact$/, () =>
      json({ kind: "event", occurrences: 1, notes: 0, recordings: 0, documents: 0, linkedTaskCount }),
    ),
    on("DELETE", /^\/api\/v1\/sessions\/E1(:|%3A)2026-10-15$/, () => json({ affected: 1, skipped: 0 })),
    on("GET", /.*/, () => json([])),
  );
  const utils = renderRoutes(
    [
      { path: "/sessions/:sessionKey/delete", element: <DeleteSessionFlow /> },
      { path: "*", element: <p>Calendar</p> },
    ],
    `/sessions/${encodeURIComponent(EVENT.key)}/delete`,
  );
  return { api, user: userEvent.setup(), ...utils };
}

describe("delete an event with a linked task (012 FR-042)", () => {
  it("asks about linked tasks and sends linkedTasks=delete when chosen", async () => {
    const { api, user } = renderDelete(1);
    const dialog = await screen.findByRole("alertdialog");
    const group = await within(dialog).findByRole("radiogroup", { name: "Linked tasks" });
    expect(within(group).getByRole("radio", { name: "Keep as tasks" })).toBeChecked();
    expect(dialog).not.toHaveTextContent("linked task");
    await user.click(within(group).getByRole("radio", { name: "Delete with the event" }));
    expect(dialog).toHaveTextContent("This will move 1 event with 1 linked task to the Trash.");
    await user.click(within(dialog).getByRole("button", { name: "Move to Trash" }));
    await waitFor(() => expect(api.calls.some((c) => c.init.method === "DELETE")).toBe(true));
    const del = api.calls.find((c) => c.init.method === "DELETE")!;
    expect(del.url.searchParams.get("linkedTasks")).toBe("delete");
    expect(del.url.searchParams.get("scope")).toBe("all");
  });

  it("shows no choice and sends no linkedTasks when nothing is linked", async () => {
    const { api, user } = renderDelete(0);
    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText(/This will move 1 event to the Trash/);
    expect(within(dialog).queryByRole("radiogroup")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Move to Trash" }));
    await waitFor(() => expect(api.calls.some((c) => c.init.method === "DELETE")).toBe(true));
    const del = api.calls.find((c) => c.init.method === "DELETE")!;
    expect(del.url.searchParams.has("linkedTasks")).toBe(false);
  });
});

describe("Export tasks (012 FR-053)", () => {
  it("downloads the CSV with the server's file name", async () => {
    const csv = "﻿Title,Description\r\nRead ş,\r\n";
    const api = mockFetch(
      on("GET", "/api/v1/tasks/export", () =>
        new Response(csv, {
          status: 200,
          headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="UniHelperProMax-tasks-2026-10-15.csv"' },
        }),
      ),
    );
    const createObjectURL = vi.fn(() => "blob:tasks");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    const user = userEvent.setup();
    renderWithProviders(<ExportTasksCard />);
    await user.click(screen.getByRole("button", { name: "Export tasks" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Tasks exported"));
    expect(api.calls[0].url.pathname).toBe("/api/v1/tasks/export");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual(["UniHelperProMax-tasks-2026-10-15.csv"]);
  });

  it("tells the user when the export fails", async () => {
    mockFetch(on("GET", "/api/v1/tasks/export", () => new Response("", { status: 500 })));
    const user = userEvent.setup();
    renderWithProviders(<ExportTasksCard />);
    await user.click(screen.getByRole("button", { name: "Export tasks" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
