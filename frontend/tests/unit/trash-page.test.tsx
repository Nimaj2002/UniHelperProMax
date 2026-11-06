import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatTitlesSentence, trashSentence } from "@/features/classes/DeleteSessionFlow";
import { impactSentence } from "@/features/courses/HierarchyMenu";
import { savedMessage } from "@/features/events/EditEventFlow";
import type { TrashEntry } from "@/features/settings/trash/api";
import { entryContent, entryDates, TrashPage } from "@/features/settings/trash/TrashPage";
import { json, mockFetch, on, renderRoutes } from "./test-utils";

const entry = (over: Partial<TrashEntry> = {}): TrashEntry => ({
  id: "e1",
  kind: "event",
  label: "AI Seminar",
  yearName: "2026",
  semesterName: "Fall 2026",
  courseName: null,
  firstDate: "2026-10-15",
  lastDate: "2026-10-15",
  startTime: "14:00",
  endTime: "15:30",
  occurrenceCount: 1,
  noteCount: 2,
  recordingCount: 1,
  documentCount: 0,
  deletedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  purgeError: null,
  missingFiles: 0,
  version: 1,
  taskCount: 0,
  chatCount: 0,
  ...over,
});

const CLASS = entry({
  id: "c1", kind: "class", label: "CS 201", courseName: "CS 201", firstDate: "2026-10-02", lastDate: "2026-12-18",
  startTime: null, endTime: null, occurrenceCount: 12, noteCount: 0, recordingCount: 0, documentCount: 0,
});
const CLASS2 = entry({ id: "c2", kind: "class", label: "Math 101", courseName: "Math 101", noteCount: 1, recordingCount: 0 });

afterEach(() => vi.unstubAllGlobals());

function renderTrash(entries: TrashEntry[]) {
  const api = mockFetch(
    on("GET", "/api/v1/trash", () => json(entries)),
    on("DELETE", /^\/api\/v1\/trash\//, () => new Response(null, { status: 204 })),
    on("POST", /^\/api\/v1\/trash\/.+\/restore$/, () =>
      json({ kind: "event", lineageId: "L", firstSessionKey: "L:2026-10-15", recreated: { year: false, semester: false, course: false }, movedFolders: 0 }),
    ),
  );
  renderRoutes([{ path: "/settings/trash", element: <TrashPage /> }], "/settings/trash");
  return api;
}

describe("Trash page", () => {
  it("lists deleted classes and deleted events, with an empty state per list", async () => {
    renderTrash([entry()]);
    const classes = await screen.findByRole("region", { name: "Deleted classes" });
    const events = screen.getByRole("region", { name: "Deleted events" });
    expect(classes).toHaveTextContent("Nothing in the Trash.");
    expect(events).toHaveTextContent("AI Seminar");
    expect(events).toHaveTextContent("2026 · Fall 2026");
    expect(events).toHaveTextContent("Thu 15 Oct 2026, 14:00–15:30");
    expect(events).toHaveTextContent(/Deleted 3 minutes ago/);
    expect(events).toHaveTextContent("2 notes · 1 recording");
  });

  it("describes dates and content", () => {
    expect(entryDates(CLASS)).toBe("12 occurrences, 2 Oct – 18 Dec 2026");
    expect(entryDates(entry({ startTime: null, endTime: null }))).toBe("Thu 15 Oct 2026");
    expect(entryContent(CLASS)).toBe("No notes, recordings or documents");
    expect(entryContent(entry({ documentCount: 3 }))).toBe("2 notes · 1 recording · 3 documents");
  });

  it("has named Restore and Delete buttons; restore calls the API with the version", async () => {
    const user = userEvent.setup();
    const api = renderTrash([entry(), CLASS]);
    await user.click(await screen.findByRole("button", { name: "Restore AI Seminar" }));
    await waitFor(() => expect(api.calls.some((c) => c.init.method === "POST")).toBe(true));
    const post = api.calls.find((c) => c.init.method === "POST")!;
    expect(post.url.pathname).toBe("/api/v1/trash/e1/restore");
    expect(new Headers(post.init.headers).get("If-Match")).toBe('"1"');
    expect(screen.getByRole("button", { name: "Delete CS 201 permanently" })).toBeVisible();
  });

  it("asks “Are you sure?” with No focused: No changes nothing, Yes deletes", async () => {
    const user = userEvent.setup();
    const api = renderTrash([CLASS, CLASS2]);
    await user.click(await screen.findByRole("button", { name: "Delete CS 201 permanently" }));
    let dialog = screen.getByRole("alertdialog", { name: "Are you sure?" });
    expect(dialog).toHaveTextContent("CS 201");
    expect(dialog).toHaveTextContent("removed from the app and from disk");
    expect(within(dialog).getByRole("button", { name: "No" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "No" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.calls.some((c) => c.init.method === "DELETE")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Delete CS 201 permanently" }));
    dialog = screen.getByRole("alertdialog", { name: "Are you sure?" });
    await user.click(within(dialog).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(api.calls.some((c) => c.init.method === "DELETE")).toBe(true));
    const del = api.calls.find((c) => c.init.method === "DELETE")!;
    expect(del.url.pathname).toBe("/api/v1/trash/c1");
  });
});

describe("deletion and edit messages (009 US3)", () => {
  it("delete confirmation names the content and the Trash", () => {
    const impact = { kind: "event" as const, occurrences: 1, notes: 2, recordings: 1, documents: 1, linkedTaskCount: 0, chats: 0, chatTitles: [] as string[], teacherChats: 0, graphIdeas: 0 };
    expect(trashSentence({ kind: "event", courseName: null }, impact)).toBe(
      "This will move 1 event with 2 notes, 1 recording and 1 document to the Trash. You can restore it from Settings → Trash.",
    );
    expect(trashSentence({ kind: "class", courseName: "CS 201" }, { ...impact, kind: "class", occurrences: 3, notes: 0, recordings: 0, documents: 0 })).toBe(
      "This will move 3 sessions of CS 201 to the Trash. You can restore them from Settings → Trash.",
    );
  });

  it("hierarchy delete names events, content and the Trash", () => {
    expect(
      impactSentence("semester", { semesters: 0, courses: 2, classes: 3, events: 1, notes: 4, recordings: 0, documents: 1, chats: 0, keptFolder: "2026/Fall", linkedTaskCount: 0, taskCount: 0 }),
    ).toBe("This also removes 2 courses from the app. Its 3 classes and 1 event, with 4 notes and 1 document, move to the Trash — each class and event can be restored from Settings → Trash.");
    expect(impactSentence("semester", { semesters: 0, courses: 0, classes: 0, events: 1, notes: 0, recordings: 0, documents: 0, chats: 0, keptFolder: "x", linkedTaskCount: 0, taskCount: 0 })).toBe(
      "Its 1 event moves to the Trash — each class and event can be restored from Settings → Trash.",
    );
    expect(impactSentence("course", { semesters: 0, courses: 0, classes: 0, events: 0, notes: 0, recordings: 0, documents: 0, chats: 0, keptFolder: "x", linkedTaskCount: 0, taskCount: 0 })).toBe(
      "This course is empty.",
    );
  });

  it("012: linked tasks are named when they go with the event; course tasks become personal", () => {
    const impact = { kind: "event" as const, occurrences: 1, notes: 1, recordings: 0, documents: 0, linkedTaskCount: 2, chats: 0, chatTitles: [] as string[], teacherChats: 0, graphIdeas: 0 };
    expect(trashSentence({ kind: "event", courseName: null }, impact)).toBe(
      "This will move 1 event with 1 note to the Trash. You can restore it from Settings → Trash.",
    );
    expect(trashSentence({ kind: "event", courseName: null }, impact, "delete")).toBe(
      "This will move 1 event with 1 note and 2 linked tasks to the Trash. You can restore it from Settings → Trash.",
    );
    const course = { semesters: 0, courses: 0, classes: 2, events: 0, notes: 0, recordings: 0, documents: 0, chats: 0, keptFolder: "x", linkedTaskCount: 0, taskCount: 3 };
    expect(impactSentence("course", course)).toBe(
      "Its 2 classes move to the Trash — each class and event can be restored from Settings → Trash. 3 tasks will become personal tasks.",
    );
    expect(impactSentence("course", { ...course, classes: 0, taskCount: 1 })).toBe("This course is empty. 1 task will become a personal task.");
    expect(entryContent(entry({ noteCount: 0, recordingCount: 0, taskCount: 1 }))).toBe("1 task");
  });

  it("014: deletions and Trash entries name the chats", () => {
    const impact = { kind: "class" as const, occurrences: 1, notes: 1, recordings: 0, documents: 0, linkedTaskCount: 0, chats: 2, chatTitles: ["Exam topics", "Week 3"], teacherChats: 0, graphIdeas: 0 };
    expect(trashSentence({ kind: "class", courseName: "CS 201" }, impact)).toBe(
      "This will move 1 session of CS 201 with 1 note and 2 chats to the Trash. You can restore it from Settings → Trash.",
    );
    // 022 FR-035: ideas only its lessons taught
    expect(trashSentence({ kind: "class", courseName: "CS 201" }, { ...impact, teacherChats: 1, graphIdeas: 3 })).toContain(
      "also removes 3 ideas from your knowledge graph",
    );
    expect(chatTitlesSentence(impact)).toBe("Chats: Exam topics and Week 3.");
    expect(chatTitlesSentence({ chats: 7, chatTitles: ["A", "B", "C", "D", "E"] })).toBe("Chats: A, B, C, D, E and 2 more.");
    expect(chatTitlesSentence({ chats: 0, chatTitles: [] })).toBe("");
    expect(
      impactSentence("course", { semesters: 0, courses: 0, classes: 2, events: 0, notes: 0, recordings: 1, documents: 0, chats: 3, keptFolder: "x", linkedTaskCount: 0, taskCount: 0 }),
    ).toBe("Its 2 classes, with 1 recording and 3 chats, move to the Trash — each class and event can be restored from Settings → Trash.");
    expect(entryContent(entry({ noteCount: 1, recordingCount: 0, chatCount: 1 }))).toBe("1 note · 1 chat");
  });

  it("series edit reports what was left unchanged", () => {
    expect(savedMessage(0)).toBe("Saved.");
    expect(savedMessage(3)).toBe("Saved. 3 events with notes, recordings or documents, or edited individually, were left unchanged.");
  });
});
