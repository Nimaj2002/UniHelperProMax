/** 022 T029/T051: the teacher tab — three labelled columns, question chips, sending with attachments. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { resetDrafts } from "@/features/chat/drafts";
import { runStore } from "@/features/chat/runStore";
import { TeacherTab } from "@/features/teacher/TeacherTab";
import { json, mockFetch, on, renderWithProviders } from "../test-utils";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onerror = null;
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const ENDPOINT = {
  id: "ep1", name: "Fake local", style: "openai", baseUrl: "http://localhost:8021/v1", locality: "local", enabled: true,
  key: { configured: false, masked: null, readable: true }, privacyAcknowledged: false, version: 1,
  models: [{ id: "m1", modelId: "echo", displayName: "Echo", capabilities: { images: false, pdf: false, audio: false }, hidden: false, source: "manual", contextLimit: null, outputLimit: null }],
};
const CHAT = {
  chat: { id: "t1", kind: "lesson", title: "Determinants", createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z", generating: false, unseenAnswer: false, unansweredCount: 1, modelLabel: "Fake local · Echo", version: 1 },
  topic: null,
  model: { endpointId: "ep1", modelId: "m1", label: "Fake local · Echo", available: true },
  turns: [
    {
      id: "u1",
      user: { id: "v1", text: "Teach me determinants", createdAt: "2026-11-05T10:00:00Z", action: null, attachments: [] },
      answer: {
        id: "a1", status: "completed", endpointLabel: "Fake local", modelLabel: "Echo", locality: "local",
        segments: [{ type: "markdown", text: "Let us check.\n" }, { type: "question", questionId: "q1" }],
      },
    },
  ],
  questions: [
    { id: "q1", answerId: "a1", kind: "choice", title: "Zero determinant", prompt: "If det(A) = 0?", options: ["Invertible", "Singular"], practice: false, status: "unanswered", revealed: false, submission: null, grades: [], hints: [] },
  ],
  plans: [],
  ideaSet: [],
  graph: { status: "pending", pendingTurns: 1 },
};

beforeEach(() => {
  resetDrafts();
  runStore().reset();
  localStorage.clear();
  vi.stubGlobal("EventSource", FakeEventSource);
  Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

it("shows three labelled columns, the question as a chip and a card, and sends with attachments", async () => {
  const sent: unknown[] = [];
  mockFetch(
    on("GET", "/api/v1/ai/endpoints", () => json([ENDPOINT])),
    on("GET", "/api/v1/ai/settings", () => json({ customInstructions: "", lastModel: null, version: 1 })),
    on("GET", "/api/v1/teacher-chats/t1", () => json(CHAT)),
    on("GET", "/api/v1/sessions/s1/chat-drafts", () =>
      json([{ chatId: "t1", text: "", attachments: [{ kind: "note", ref: "n1" }], updatedAt: "2026-11-05T10:00:00Z" }]),
    ),
    on("PUT", "/api/v1/sessions/s1/chat-drafts", (_u, init) => json(JSON.parse(String(init.body)))),
    on("POST", "/api/v1/teacher-chats/t1/messages", (_u, init) => {
      sent.push(JSON.parse(String(init.body)));
      return json({ chat: CHAT.chat, runId: "r1", turnId: "u2", answerId: "a2", graded: [] }, 202);
    }),
    on("GET", "/api/v1/sessions/s1/teacher-chats", () => json([CHAT.chat])),
  );
  const { container } = renderWithProviders(<TeacherTab sessionKey="s1" tabId="t1" />);
  expect(await screen.findByRole("region", { name: "Teacher" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Current question" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Your questions" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /Question 1 · Zero determinant/ })).toBeInTheDocument();
  expect(screen.getByRole("listbox", { name: "Questions" })).toBeInTheDocument();
  const current = screen.getByRole("region", { name: "Current question" });
  expect(within(current).getByRole("radio", { name: /Singular/ })).toBeInTheDocument();
  expect(screen.getByText("Graph update pending")).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();

  const box = screen.getByRole("textbox", { name: /message/i });
  await userEvent.type(box, "Why is that?{Enter}");
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toMatchObject({ text: "Why is that?", model: { endpointId: "ep1", modelId: "m1" }, attachments: [{ kind: "note", ref: "n1" }] });
});

it("below 1100 px the Your questions column starts closed; the toggles open and close the side columns", async () => {
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  mockFetch(
    on("GET", "/api/v1/ai/endpoints", () => json([ENDPOINT])),
    on("GET", "/api/v1/ai/settings", () => json({ customInstructions: "", lastModel: null, version: 1 })),
    on("GET", "/api/v1/teacher-chats/t1", () => json(CHAT)),
    on("GET", "/api/v1/sessions/s1/chat-drafts", () => json([])),
  );
  renderWithProviders(<TeacherTab sessionKey="s1" tabId="t1" />);
  const toggle = await screen.findByRole("button", { name: "Your questions" });
  expect(screen.queryByRole("region", { name: "Your questions" })).not.toBeInTheDocument();
  await userEvent.click(toggle);
  expect(screen.getByRole("region", { name: "Your questions" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Answers" }));
  expect(screen.queryByRole("region", { name: "Current question" })).not.toBeInTheDocument();
});
