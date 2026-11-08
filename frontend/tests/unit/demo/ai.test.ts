import { describe, expect, it, vi } from "vitest";
import type { Schemas } from "@/lib/api";
import { DEMO_LINE } from "@/demo/canned/ai";
import { IDS, pastKeys } from "@/demo/seed";
import { api, raw, startDemoServer } from "./setup";

startDemoServer();

const MODEL = { endpointId: "demo-ai", modelId: "demo-model" };
const enc = encodeURIComponent;

interface Frame {
  id: number;
  type: string;
  data: Record<string, unknown>;
}

/** Read a run's whole event stream (fake timers drive the run). */
async function events(runId: string, lastEventId = 0): Promise<Frame[]> {
  const res = await raw(`/chat-runs/${runId}/events${lastEventId ? `?lastEventId=${lastEventId}` : ""}`);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = res.text();
  await vi.advanceTimersByTimeAsync(10_000); // well past the longest canned reply
  return (await body)
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const f = Object.fromEntries(block.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)]));
      return { id: Number(f.id), type: f.event, data: JSON.parse(f.data) as Record<string, unknown> };
    });
}

const sessionKey = () => pastKeys(IDS.algoLineage)[0];

describe("demo AI chat", () => {
  it("offers a ready Demo AI endpoint", async () => {
    const endpoints = await api<Schemas["AiEndpointOut"][]>("/ai/endpoints");
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({ name: "Demo AI", enabled: true });
    const settings = await api<Schemas["AiSettingsOut"]>("/ai/settings");
    expect(settings.lastModel).toEqual(MODEL);
  });

  it("lists the seeded chat for the latest Algorithms session", async () => {
    const list = await api<Schemas["ChatSummary"][]>(`/sessions/${enc(sessionKey())}/chats`);
    expect(list).toHaveLength(1);
    const chat = await api<Schemas["ChatOut"]>(`/chats/${list[0].id}`);
    expect(chat.turns).toHaveLength(2);
    expect(chat.turns[0].versions[0].answers[0].text.endsWith(DEMO_LINE)).toBe(true);
  });

  it("streams a canned answer and saves it", async () => {
    const [seeded] = await api<Schemas["ChatSummary"][]>(`/sessions/${enc(sessionKey())}/chats`);
    const sent = await api<Schemas["SendResult"]>(`/chats/${seeded.id}/messages`, {
      method: "POST",
      body: { text: "Can you explain the master theorem?", model: MODEL },
    });
    expect(sent.runId).toBeTruthy();
    expect(sent.answerId).toBeTruthy();

    const frames = await events(sent.runId);
    const types = frames.map((f) => f.type);
    expect(types[0]).toBe("start");
    expect(types.filter((t) => t === "delta").length).toBeGreaterThanOrEqual(2);
    expect(types[types.length - 1]).toBe("done");
    expect(frames.map((f) => f.id)).toEqual(frames.map((_, i) => i + 1));
    const text = frames.filter((f) => f.type === "delta").map((f) => f.data.text).join("");
    expect(text.endsWith(DEMO_LINE)).toBe(true);

    const chat = await api<Schemas["ChatOut"]>(`/chats/${seeded.id}`);
    const answer = chat.turns[2].versions[0].answers[0];
    expect(answer).toMatchObject({ id: sent.answerId, status: "completed", text });
    expect(chat.generating).toBe(false);

    // a resumed subscription only gets what it hasn't seen
    const tail = await events(sent.runId, frames.length - 1);
    expect(tail.map((f) => f.type)).toEqual(["done"]);
  });

  it("stops mid-stream and keeps the text so far", async () => {
    const sent = await api<Schemas["SendResult"]>(`/sessions/${enc(sessionKey())}/chats`, {
      method: "POST",
      body: { text: "Summarize the lecture", model: MODEL },
    });
    expect(await api<Schemas["ChatRunOut"][]>("/chat-runs/active")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    const stopped = await api<Schemas["ChatRunOut"]>(`/chat-runs/${sent.runId}/stop`, { method: "POST" });
    expect(stopped.status).toBe("stopped");
    const frames = await events(sent.runId);
    expect(frames[frames.length - 1].type).toBe("stopped");
    const chat = await api<Schemas["ChatOut"]>(`/chats/${sent.chat.id}`);
    const answer = chat.turns[0].versions[0].answers[0];
    expect(answer.status).toBe("stopped");
    expect(answer.text.length).toBeGreaterThan(0);
    expect(answer.text.endsWith(DEMO_LINE)).toBe(false);
  });

  it("appends an answer to a note, never replacing it", async () => {
    const [seeded] = await api<Schemas["ChatSummary"][]>(`/sessions/${enc(sessionKey())}/chats`);
    const chat = await api<Schemas["ChatOut"]>(`/chats/${seeded.id}`);
    const answerId = chat.turns[0].versions[0].answers[0].id;
    const path = `/chats/${seeded.id}/answers/${answerId}/append-to-note`;
    type Appended = Schemas["unihelper__schemas__chat__AppendResult"];
    const first = await api<Appended>(path, { method: "POST", body: { newNoteTitle: "From chat" } });
    expect(first.text).toMatch(/^## Chat — /);
    expect(first.text.trim().endsWith(DEMO_LINE)).toBe(true);
    const second = await api<Appended>(path, { method: "POST", body: { noteId: first.noteId } });
    expect(second.previousHash).toBe(first.hash);
    expect(second.version).toBe(first.version + 1);
    await expect(api(path, { method: "POST", body: { noteId: "nope" } })).rejects.toMatchObject({ status: 404 });
  });

  it("answers unknown chats and runs with 404", async () => {
    await expect(api("/chats/nope")).rejects.toMatchObject({ status: 404 });
    expect((await raw("/chat-runs/nope/events")).status).toBe(404);
  });
});

describe("demo AI teacher", () => {
  it("serves the seeded lesson and knowledge graph", async () => {
    const list = await api<Schemas["TeacherChatSummary"][]>(`/sessions/${enc(sessionKey())}/teacher-chats`);
    expect(list).toHaveLength(1);
    const chat = await api<Schemas["TeacherChatOut"]>(`/teacher-chats/${list[0].id}`);
    expect(chat.questions.length).toBeGreaterThanOrEqual(2);
    expect(chat.questions.every((q) => q.status === "correct")).toBe(true);
    expect(chat.plans).toHaveLength(1);
    const graph = await api<Schemas["GraphOut"]>("/knowledge-graph");
    expect(graph.ideas.length).toBeGreaterThanOrEqual(4);
    const idea = await api<Schemas["IdeaDetail"]>(`/knowledge-graph/ideas/${graph.ideas[0].id}`);
    expect(idea.sources[0].chatId).toBe(list[0].id);
  });

  it("starts a practice chat whose questions can be answered", async () => {
    const sent = await api<Schemas["TeacherSendResult"]>(`/sessions/${enc(sessionKey())}/teacher-chats`, {
      method: "POST",
      body: { text: "Practice recurrences", model: MODEL, kind: "practice" },
    });
    const frames = await events(sent.runId);
    expect(frames.filter((f) => f.type === "question")).toHaveLength(2);
    expect(frames[frames.length - 1].type).toBe("done");
    const chat = await api<Schemas["TeacherChatOut"]>(`/teacher-chats/${sent.chat.id}`);
    expect(chat.chat.unansweredCount).toBe(2);
    const choice = chat.questions.find((q) => q.kind === "choice")!;
    expect(choice.key).toBeUndefined();
    const answered = await api<Schemas["TeacherSendResult"]>(`/teacher-chats/${sent.chat.id}/answers`, {
      method: "POST",
      body: { model: MODEL, answers: [{ questionId: choice.id, choice: 1, confidence: 75 }] },
    });
    expect(answered.graded?.[0]).toMatchObject({ id: choice.id, status: "correct", key: 1 });
  });

  it("answers unknown teacher chats with 404", async () => {
    await expect(api("/teacher-chats/nope")).rejects.toMatchObject({ status: 404 });
  });
});
