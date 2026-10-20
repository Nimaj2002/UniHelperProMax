/** 014 T088: the Chat section's History view (contracts/ui-contract.md "History view"). */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { ChatSummary } from "@/features/chat/api";
import { setPanelChat, setSearchOpen } from "@/features/chat/chatPlacement";
import { ChatSection, ChatSectionActions } from "@/features/chat/ChatSection";
import { resetDrafts } from "@/features/chat/drafts";
import { HistoryView } from "@/features/chat/HistoryView";
import { runStore } from "@/features/chat/runStore";
import { json, mockFetch, on, renderWithProviders, type Handler } from "./test-utils";

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

class FakeEventSource {
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = 1;
  onerror = null;
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const DAY = 86_400_000;
const summary = (i: number, over: Partial<ChatSummary> = {}): ChatSummary => ({
  id: `c${i}`,
  title: `Chat number ${i} about a rather long topic that needs more than one line to show in full`,
  createdAt: new Date(Date.now() - (i + 2) * DAY).toISOString(),
  updatedAt: new Date(Date.now() - (i + 2) * DAY).toISOString(),
  generating: false,
  unseenAnswer: false,
  messageCount: 2,
  modelLabel: "echo",
  version: 1,
  ...over,
});
const SEVEN = Array.from({ length: 7 }, (_, i) => summary(i));
const ENDPOINT = {
  id: "ep1", name: "Fake local", style: "openai", baseUrl: "http://localhost:8021/v1", locality: "local", enabled: true,
  key: { configured: false, masked: null, readable: true }, privacyAcknowledged: false, version: 1,
  models: [{ id: "m1", modelId: "echo", displayName: "Echo", capabilities: { images: false, pdf: false, audio: false }, hidden: false, source: "manual", contextLimit: null, outputLimit: null }],
};
const turnChat = (id: string, title: string) => ({
  ...summary(0, { id, title }),
  sessionKey: "s1",
  model: { endpointId: "ep1", modelId: "m1" },
  context: [],
  turns: [
    {
      id: "t1",
      selected: 0,
      versions: [
        {
          id: "v1", text: title, createdAt: new Date().toISOString(), attachments: [], selectedAnswer: 0,
          answers: [{ id: "a1", text: "", status: "streaming", endpointLabel: "Fake local", modelLabel: "Echo", locality: "local", startedAt: new Date().toISOString(), runId: "r1" }],
        },
      ],
    },
  ],
});

function api(chats: ChatSummary[] = SEVEN, extra: Handler[] = []) {
  return mockFetch(
    ...extra,
    on("GET", "/api/v1/sessions/s1/chats", (url) => {
      const q = url.searchParams.get("q")?.toLowerCase();
      return json(q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats);
    }),
    on("GET", "/api/v1/sessions/s1/chat-drafts", () => json([])),
    on("PUT", "/api/v1/sessions/s1/chat-drafts", (_u, init) => json(JSON.parse(String(init.body)))),
    on("GET", "/api/v1/ai/endpoints", () => json([ENDPOINT])),
    on("GET", "/api/v1/ai/settings", () => json({ customInstructions: "", lastModel: { endpointId: "ep1", modelId: "m1" }, version: 1 })),
    on("POST", /^\/api\/v1\/chats\/[^/]+\/seen$/, () => new Response(null, { status: 204 })),
  );
}

function history(props: Partial<Parameters<typeof HistoryView>[0]> = {}) {
  const onOpen = vi.fn();
  const utils = renderWithProviders(<HistoryView sessionKey="s1" searching={false} onCloseSearch={() => {}} onOpen={onOpen} inTabs={[]} {...props} />);
  return { ...utils, onOpen };
}

beforeEach(() => {
  toastMock.mockClear();
  resetDrafts();
  setPanelChat("s1", { chatId: null, view: "history" });
  setSearchOpen("panel", false);
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  runStore().reset();
  vi.unstubAllGlobals();
});

describe("chat history", () => {
  it("shows five chats, then More (N) expands the rest", async () => {
    const user = userEvent.setup();
    api();
    const { container } = history();
    const list = await screen.findByRole("list", { name: "Chats" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "More (2)" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /More/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("truncates titles but names each chat in full, with its age and exact date", async () => {
    api();
    history();
    const open = await screen.findByRole("button", { name: SEVEN[0].title });
    expect(open).toHaveAttribute("title", SEVEN[0].title);
    expect(within(open).getByText(SEVEN[0].title)).toHaveClass("truncate");
    const time = within(open).getByText("2 days ago");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("title")).toMatch(/\d{4}/);
  });

  it("marks chats generating and chats open in a tab", async () => {
    api([summary(1, { generating: true }), summary(2)]);
    history({ inTabs: ["c2"] });
    const [first, second] = await screen.findAllByRole("listitem");
    expect(within(first).getByText("Generating")).toBeInTheDocument();
    expect(within(second).getByText("Open in tab")).toBeInTheDocument();
    expect(within(first).queryByText("Open in tab")).toBeNull();
  });

  it("renames with the keyboard (Enter saves; If-Match sent)", async () => {
    const user = userEvent.setup();
    const calls = api([summary(1)], [on("PATCH", "/api/v1/chats/c1", () => json({ ...turnChat("c1", "Renamed"), turns: [] }))]);
    history();
    const actions = await screen.findByRole("button", { name: "Chat actions" });
    actions.focus();
    await user.keyboard("{Enter}");
    const rename = await screen.findByRole("menuitem", { name: "Rename" });
    await waitFor(() => expect(rename).toHaveFocus());
    await user.keyboard("{Enter}");
    const input = await screen.findByRole("textbox", { name: "Chat title" });
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");
    await waitFor(() => expect(calls.calls.some((c) => c.init.method === "PATCH")).toBe(true));
    const patch = calls.calls.find((c) => c.init.method === "PATCH")!;
    expect(JSON.parse(String(patch.init.body))).toEqual({ title: "Renamed" });
    expect((patch.init.headers as Record<string, string>)["If-Match"]).toBe('"1"');
  });

  it("Escape cancels a rename", async () => {
    const user = userEvent.setup();
    const calls = api([summary(1)]);
    history();
    await user.click(await screen.findByRole("button", { name: "Chat actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Chat title" });
    await user.type(input, " more{Escape}");
    expect(screen.queryByRole("textbox", { name: "Chat title" })).toBeNull();
    expect(calls.calls.some((c) => c.init.method === "PATCH")).toBe(false);
  });

  it("Delete shows a toast with Undo for 10 s that restores the chat", async () => {
    const user = userEvent.setup();
    const calls = api([summary(1), summary(2)], [
      on("DELETE", "/api/v1/chats/c1", () => new Response(null, { status: 204 })),
      on("POST", "/api/v1/chats/c1/restore", () => json(summary(1))),
    ]);
    const onDeleted = vi.fn();
    history({ onDeleted });
    const [first] = await screen.findAllByRole("listitem");
    await user.click(within(first).getByRole("button", { name: "Chat actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const [message, options] = toastMock.mock.calls[0] as [string, { duration: number; action: { label: string; onClick: () => void } }];
    expect(message).toBe("Chat deleted");
    expect(options.duration).toBe(10_000);
    expect(options.action.label).toBe("Undo");
    expect(onDeleted).toHaveBeenCalledWith("c1");
    expect(calls.calls.find((c) => c.init.method === "DELETE")!.init.headers).toMatchObject({ "If-Match": '"1"' });
    act(() => options.action.onClick());
    await waitFor(() => expect(calls.calls.some((c) => c.url.pathname === "/api/v1/chats/c1/restore")).toBe(true));
  });

  it("the search box filters the list by title", async () => {
    const user = userEvent.setup();
    const calls = api([summary(1, { title: "Exam topics" }), summary(2, { title: "Week 3 recap" })]);
    renderWithProviders(
      <>
        <ChatSectionActions sessionKey="s1" />
        <ChatSection sessionKey="s1" />
      </>,
    );
    await screen.findByRole("button", { name: "Exam topics" });
    await user.click(screen.getByRole("button", { name: "Search chats" }));
    const search = screen.getByRole("searchbox", { name: "Search chats" });
    expect(search).toHaveFocus();
    await user.type(search, "exam");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Week 3 recap" })).toBeNull());
    expect(screen.getByRole("button", { name: "Exam topics" })).toBeInTheDocument();
    expect(calls.calls.some((c) => c.url.searchParams.get("q") === "exam" && c.url.searchParams.get("in") === "title")).toBe(true);
  });

  it("sending from History starts a new chat; Back during generation keeps the run", async () => {
    const user = userEvent.setup();
    const created = summary(9, { id: "c-new", title: "What is a heap?", generating: true });
    const calls = api([], [
      on("POST", "/api/v1/sessions/s1/chats", () => json({ chat: created, runId: "r1", turnId: "t1", answerId: "a1" }, 201)),
      on("GET", "/api/v1/chats/c-new", () => json(turnChat("c-new", "What is a heap?"))),
    ]);
    renderWithProviders(
      <>
        <ChatSectionActions sessionKey="s1" />
        <ChatSection sessionKey="s1" />
      </>,
    );
    expect(await screen.findByRole("button", { name: "New chat" })).toHaveAttribute("aria-keyshortcuts", "Alt+Shift+K");
    const box = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Model: Echo, Local" })).toBeInTheDocument());
    await user.type(box, "What is a heap?{Enter}");
    await waitFor(() => expect(calls.calls.some((c) => c.init.method === "POST" && c.url.pathname === "/api/v1/sessions/s1/chats")).toBe(true));
    const body = JSON.parse(String(calls.calls.find((c) => c.url.pathname === "/api/v1/sessions/s1/chats" && c.init.method === "POST")!.init.body));
    expect(body).toEqual({ text: "What is a heap?", model: { endpointId: "ep1", modelId: "m1" }, attachments: [] });
    // the Conversation view of the new chat
    expect(await screen.findByRole("heading", { level: 3, name: "What is a heap?" })).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "Conversation" })).toHaveAttribute("aria-live", "off");
    expect(runStore().get("r1")?.status).toBe("queued");
    expect(FakeEventSource.all).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to history" }));
    expect(await screen.findByRole("button", { name: "Search chats" })).toBeInTheDocument();
    // the answer goes on
    expect(FakeEventSource.all[0].readyState).toBe(1);
    expect(runStore().get("r1")?.status).toBe("queued");
  });
});
