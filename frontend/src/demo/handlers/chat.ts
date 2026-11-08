/**
 * 024: AI settings reads and the simulated session AI chat (contracts/demo-mode.md §2, specs/014).
 * One ready-to-use "Demo AI" endpoint; answers are canned replies (canned/ai.ts) streamed through
 * the run registry (sse.ts), which teacher runs share.
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { chatReply, DEMO_AI, DEMO_MODEL_LABEL, SEED_CHAT } from "../canned/ai";
import { getSession, parseKey } from "../calendar";
import { API, checkIfMatch, json, noContent, notFound, problem, readJson, validation, type Body } from "../http";
import { appendToNote, createNote, findNote } from "./notes";
import { IDS, pastKeys } from "../seed";
import { bump, getStore, newId, nowIso, registerSlice } from "../store";
import { activeRunFor, activeRuns, clearRuns, deltas, eventStream, getRun, runOut, startRun, stopRun, usageOf } from "../sse";
import { findTeacherChat, T, teacherSummary } from "./teacher";

type Chat = Schemas["ChatOut"];
type Turn = Schemas["TurnOut"];
type Version = Schemas["UserVersionOut"];
type Answer = Schemas["AnswerOut"];
type Draft = Schemas["ChatDraftIo"];
type Ref = Schemas["ContextItemRef"];

// ───────────────────────────── AI configuration ─────────────────────────────

const MB = 1024 * 1024;
const IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const limits = (images: number, pdf: number, audio: number, perMessage: number, audioTypes: string[]): Schemas["Limits"] => ({
  maxAttachments: 10,
  perFileBytes: { image: images * MB, pdf: pdf * MB, audio: audio * MB },
  perMessageBytes: perMessage * MB,
  maxImages: null,
  maxPdfPages: null,
  imageTypes: IMAGES,
  audioTypes,
});

const STYLES: Schemas["AiStyle"][] = [
  {
    id: "openai",
    label: "OpenAI-compatible",
    exampleBaseUrls: ["https://api.openai.com/v1", "http://localhost:11434/v1"],
    chatPath: "/chat/completions",
    modelsPath: "/models",
    keyHeader: "Authorization: Bearer",
    defaultCapabilities: { images: true, pdf: false, audio: false },
    limits: limits(20, 50, 25, 50, ["audio/wav", "audio/mpeg"]),
  },
  {
    id: "anthropic",
    label: "Anthropic",
    exampleBaseUrls: ["https://api.anthropic.com"],
    chatPath: "/v1/messages",
    modelsPath: "/v1/models",
    keyHeader: "x-api-key",
    defaultCapabilities: { images: true, pdf: true, audio: false },
    limits: { ...limits(10, 32, 0, 32, []), maxImages: 100, maxPdfPages: 100 },
  },
  {
    id: "gemini",
    label: "Google Gemini",
    exampleBaseUrls: ["https://generativelanguage.googleapis.com"],
    chatPath: "/v1beta/models/{model}:streamGenerateContent?alt=sse",
    modelsPath: "/v1beta/models",
    keyHeader: "x-goog-api-key",
    defaultCapabilities: { images: true, pdf: true, audio: true },
    limits: limits(20, 50, 20, 20, ["audio/wav", "audio/mpeg", "audio/webm", "audio/ogg"]),
  },
];

const ENDPOINT: Schemas["AiEndpointOut"] = {
  id: DEMO_AI.endpointId,
  name: DEMO_AI.endpointLabel,
  style: "openai",
  baseUrl: "https://demo.unihelperpromax.tech/v1",
  locality: DEMO_AI.locality,
  enabled: true,
  key: { configured: false, masked: null, readable: true },
  models: [
    {
      id: DEMO_AI.modelId,
      modelId: "demo-tutor",
      displayName: DEMO_AI.modelLabel,
      capabilities: { images: true, pdf: true, audio: false },
      hidden: false,
      source: "manual",
      contextLimit: 128_000,
      outputLimit: 4096,
    },
  ],
  privacyAcknowledged: true,
  version: 1,
};

// ───────────────────────────── state ─────────────────────────────

const S = {
  chats: [] as Chat[],
  deleted: new Set<string>(),
  drafts: new Map<string, Draft[]>(), // by session key
  settings: { customInstructions: "", lastModel: null, version: 1, useProxy: false } as Schemas["AiSettingsOut"],
};

const DEMO_REF = { endpointId: DEMO_AI.endpointId, modelId: DEMO_AI.modelId };

const findChat = (id: string) => (S.deleted.has(id) ? undefined : S.chats.find((c) => c.id === id));

const selectedVersion = (t: Turn) => t.versions[t.selected] ?? t.versions[0];
const selectedAnswer = (v: Version): Answer | undefined => v.answers[v.selectedAnswer] ?? v.answers[0];

function summary(c: Chat, match: string | null = null): Schemas["ChatSummary"] {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    generating: !!activeRunFor(c.id),
    unseenAnswer: c.unseenAnswer,
    messageCount: c.turns.reduce((n, t) => n + 1 + (selectedAnswer(selectedVersion(t)) ? 1 : 0), 0),
    modelLabel: c.modelLabel,
    match,
    version: c.version,
  };
}

const view = (c: Chat): Chat => ({ ...c, ...summary(c) });

const contextItem = (r: Ref): Schemas["ContextItem"] => ({
  kind: r.kind,
  ref: r.ref,
  pdfMode: r.pdfMode ?? null,
  title: r.ref,
  mime: null,
  size: null,
  available: true,
  addedAt: nowIso(),
});

function mergeContext(c: Chat, refs: Ref[] = []): Schemas["ContextItem"][] {
  const items = refs.map(contextItem);
  for (const i of items) if (!c.context.some((x) => x.kind === i.kind && x.ref === i.ref)) c.context.push(i);
  return items;
}

const newAnswer = (status: Answer["status"] = "queued", text = "", at = nowIso()): Answer => ({
  id: newId("ans"),
  text,
  status,
  endpointLabel: DEMO_AI.endpointLabel,
  modelLabel: DEMO_AI.modelLabel,
  locality: DEMO_AI.locality,
  startedAt: at,
  endedAt: status === "completed" ? at : null,
  usage: null,
  error: null,
  runId: null,
});

const newVersion = (text: string, attachments: Schemas["ContextItem"][], answer: Answer, at = nowIso()): Version => ({
  id: newId("msg"),
  text,
  createdAt: at,
  attachments,
  noteSnapshots: [],
  answers: [answer],
  selectedAnswer: 0,
});

/** Stream the canned reply to `question` into `answer`. */
function launch(c: Chat, turn: Turn, answer: Answer, question: string, status = 202): Response {
  const reply = chatReply(question);
  c.model = DEMO_REF;
  c.modelLabel = DEMO_MODEL_LABEL;
  c.updatedAt = nowIso();
  S.settings.lastModel = DEMO_REF;
  const run = startRun({
    id: newId("run"),
    chatId: c.id,
    sessionKey: c.sessionKey,
    turnId: turn.id,
    answerId: answer.id,
    teacher: false,
    endpointLabel: DEMO_AI.endpointLabel,
    modelLabel: DEMO_AI.modelLabel,
    locality: DEMO_AI.locality,
    steps: [...deltas(reply), usageOf(question, reply)],
    apply: (ev) => {
      switch (ev.type) {
        case "start":
          answer.status = "streaming";
          break;
        case "delta":
          answer.text += ev.data.text;
          break;
        case "usage":
          answer.usage = ev.data;
          break;
        case "done":
        case "stopped":
          answer.status = ev.data.status;
          answer.endedAt = ev.data.endedAt ?? nowIso();
          answer.runId = null;
          c.unseenAnswer = true;
          c.updatedAt = nowIso();
          break;
      }
    },
  });
  answer.runId = run.id;
  return json<Schemas["SendResult"]>(
    { chat: summary(c), runId: run.id, turnId: turn.id, answerId: answer.id },
    status,
  );
}

const busy = () => problem(409, "run_active", "An answer is still being generated in this chat.");
const empty = () => problem(422, "empty_message", "Type a message or attach something to send.");
const isEmpty = (b: Partial<Schemas["SendMessage"]>) => !b.text?.trim() && !b.attachments?.length;

// ───────────────────────────── seed ─────────────────────────────

function seed() {
  clearRuns();
  S.chats = [];
  S.deleted = new Set();
  S.drafts = new Map();
  S.settings = { customInstructions: "", lastModel: DEMO_REF, version: 1, useProxy: false };
  const key = pastKeys(IDS.algoLineage)[0];
  if (!key) return;
  const at = getSession(key)?.end ?? nowIso();
  const turns: Turn[] = SEED_CHAT.turns.map((t) => ({
    id: newId("turn"),
    selected: 0,
    versions: [newVersion(t.question, [], { ...newAnswer("completed", t.answer, at), usage: usageOf(t.question, t.answer).data as Schemas["Usage"] }, at)],
  }));
  S.chats.push({
    id: "chat-1",
    title: SEED_CHAT.title,
    createdAt: at,
    updatedAt: at,
    generating: false,
    unseenAnswer: false,
    messageCount: 0,
    modelLabel: DEMO_MODEL_LABEL,
    match: null,
    version: 1,
    sessionKey: key,
    model: DEMO_REF,
    context: [],
    turns,
  });
}

registerSlice({
  name: "chat",
  seed,
  removeSessions: (keys) => {
    S.chats = S.chats.filter((c) => !keys.has(c.sessionKey));
    for (const k of keys) S.drafts.delete(k);
  },
  count: (keys) => ({ chats: S.chats.filter((c) => !S.deleted.has(c.id) && keys.has(c.sessionKey)).length }),
  snapshot: (lineageIds) => {
    const saved = structuredClone(S.chats.filter((c) => lineageIds.has(parseKey(c.sessionKey)?.lineageId ?? "")));
    return () => {
      for (const c of saved) if (!S.chats.some((x) => x.id === c.id)) S.chats.push(c);
    };
  },
});

// ───────────────────────────── append to note (Principle I) ─────────────────────────────

async function appendAnswer(c: Chat, answer: Answer, target: Schemas["AppendTarget"]): Promise<Response> {
  let note;
  if (target.noteId) {
    note = findNote(target.noteId);
    if (!note) return notFound("Note");
  } else if (target.newNoteTitle?.trim()) {
    note = createNote(c.sessionKey, target.newNoteTitle);
    if (note instanceof Response) return note;
  } else return validation("noteId", "Choose a note or name a new one.", "note_required");
  const when = new Intl.DateTimeFormat("sv-SE", { timeZone: getStore().timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date());
  const result = await appendToNote(note, `## Chat — ${c.title} · ${when}\n\n${answer.text.trim()}\n`);
  return json<Schemas["unihelper__schemas__chat__AppendResult"]>({ noteId: note.id, ...result });
}

// ───────────────────────────── handlers ─────────────────────────────

const id = (p: unknown) => String(p);
const chatNotFound = () => notFound("Chat");

export const handlers: HttpHandler[] = [
  http.get(`${API}/ai/styles`, () => json(STYLES)),
  http.get(`${API}/ai/endpoints`, () => json([ENDPOINT])),
  http.get(`${API}/ai/endpoints/:id`, ({ params }) => (id(params.id) === ENDPOINT.id ? json(ENDPOINT) : notFound("Endpoint"))),
  http.get(`${API}/ai/settings`, () => json(S.settings)),
  http.put(`${API}/ai/settings`, async ({ request }) => {
    const conflict = checkIfMatch(request, S.settings);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/ai/settings", "put">>(request);
    S.settings.customInstructions = body.customInstructions ?? "";
    if (body.useProxy != null) S.settings.useProxy = body.useProxy;
    bump(S.settings);
    return json(S.settings);
  }),

  http.get(`${API}/sessions/:key/chats`, ({ params, request }) => {
    const key = id(params.key);
    const u = new URL(request.url).searchParams;
    const needle = (u.get("q") ?? "").trim().toLowerCase();
    const inText = u.get("in") === "text";
    const out: Schemas["ChatSummary"][] = [];
    const list = S.chats.filter((c) => c.sessionKey === key && !S.deleted.has(c.id));
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const c of list) {
      if (!needle) {
        out.push(summary(c));
        continue;
      }
      const hit = inText
        ? c.turns.flatMap((t) => t.versions.flatMap((v) => [v.text, ...v.answers.map((a) => a.text)])).find((s) => s.toLowerCase().includes(needle))
        : undefined;
      if (hit) {
        const i = hit.toLowerCase().indexOf(needle);
        out.push(summary(c, hit.slice(Math.max(0, i - 40), i + needle.length + 40)));
      } else if (c.title.toLowerCase().includes(needle)) out.push(summary(c));
    }
    return json(out);
  }),

  http.post(`${API}/sessions/:key/chats`, async ({ params, request }) => {
    const key = id(params.key);
    if (!getSession(key)) return notFound("Session");
    const body = await readJson<Body<"/api/v1/sessions/{session_key}/chats", "post">>(request);
    if (isEmpty(body)) return empty();
    const at = nowIso();
    const text = body.text.trim();
    const c: Chat = {
      id: newId("chat"),
      title: text ? text.split(/\s+/).join(" ").slice(0, 60) : "New chat",
      createdAt: at,
      updatedAt: at,
      generating: false,
      unseenAnswer: false,
      messageCount: 0,
      modelLabel: DEMO_MODEL_LABEL,
      match: null,
      version: 1,
      sessionKey: key,
      model: DEMO_REF,
      context: [],
      turns: [],
    };
    const answer = newAnswer();
    const turn: Turn = { id: newId("turn"), selected: 0, versions: [newVersion(body.text, mergeContext(c, body.attachments), answer)] };
    c.turns.push(turn);
    S.chats.push(c);
    S.drafts.set(key, (S.drafts.get(key) ?? []).filter((d) => d.chatId !== null));
    return launch(c, turn, answer, body.text, 201);
  }),

  http.post(`${API}/chats/preflight`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/chats/preflight", "post">>(request);
    const tokens = (s: string) => Math.ceil(s.length / 4);
    let history = 0;
    let context: Ref[] = [];
    if (body.chatId) {
      const c = findChat(body.chatId);
      if (!c) return chatNotFound();
      context = [...c.context];
      for (const t of c.turns) {
        const v = selectedVersion(t);
        history += tokens(v.text) + tokens(selectedAnswer(v)?.text ?? "");
      }
    } else if (!getSession(body.sessionKey)) return notFound("Session");
    for (const r of body.attachments ?? []) if (!context.some((x) => x.kind === r.kind && x.ref === r.ref)) context.push(r);
    const items: Schemas["PreflightItem"][] = context.map((r) => ({
      ...contextItem(r),
      addedAt: null,
      accepted: true,
      reason: null,
      reasonCode: null,
      textFallbackAvailable: false,
      pdfHasText: null,
      estimatedTokens: 800,
    }));
    const estimated = history + tokens(body.text ?? "") + items.length * 800 + tokens(S.settings.customInstructions);
    return json<Schemas["PreflightResult"]>({
      items,
      estimatedTokens: estimated,
      contextLimit: 128_000,
      overLimit: estimated > 128_000,
      limits: STYLES[0].limits,
      locality: DEMO_AI.locality,
      privacyAckRequired: false,
    });
  }),

  http.get(`${API}/chats/:id`, ({ params }) => {
    const c = findChat(id(params.id));
    return c ? json(view(c)) : chatNotFound();
  }),

  http.patch(`${API}/chats/:id`, async ({ params, request }) => {
    const c = findChat(id(params.id));
    if (!c) return chatNotFound();
    const conflict = checkIfMatch(request, c);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/chats/{chat_id}", "patch">>(request);
    if (body.title != null) {
      const title = body.title.split(/\s+/).filter(Boolean).join(" ");
      if (!title) return validation("title", "Enter a title.", "title_required");
      c.title = title;
    }
    if (body.model) c.model = body.model;
    if (body.context) {
      const keep = body.context;
      c.context = c.context.filter((x) => keep.some((k) => k.kind === x.kind && k.ref === x.ref));
    }
    c.updatedAt = nowIso();
    bump(c);
    return json(view(c));
  }),

  // teacher chats are chats here (022): delete and restore reach both kinds
  http.delete(`${API}/chats/:id`, ({ params, request }) => {
    const chatId = id(params.id);
    const c = findChat(chatId);
    const t = c ? undefined : findTeacherChat(chatId);
    if (!c && !t) return chatNotFound();
    const conflict = checkIfMatch(request, c ?? t!.summary);
    if (conflict) return conflict;
    const run = activeRunFor(chatId);
    if (run) stopRun(run);
    (c ? S.deleted : T.deleted).add(chatId);
    return noContent();
  }),

  http.post(`${API}/chats/:id/restore`, ({ params }) => {
    const chatId = id(params.id);
    if (S.deleted.delete(chatId) || findChat(chatId)) return json(summary(findChat(chatId)!));
    T.deleted.delete(chatId);
    const t = findTeacherChat(chatId);
    if (!t) return chatNotFound();
    const s = teacherSummary(t);
    return json<Schemas["ChatSummary"]>({ ...s, messageCount: t.turns.length * 2, match: null });
  }),

  http.post(`${API}/chats/:id/messages`, async ({ params, request }) => {
    const c = findChat(id(params.id));
    if (!c) return chatNotFound();
    const body = await readJson<Body<"/api/v1/chats/{chat_id}/messages", "post">>(request);
    if (isEmpty(body)) return empty();
    if (activeRunFor(c.id)) return busy();
    const answer = newAnswer();
    const turn: Turn = { id: newId("turn"), selected: 0, versions: [newVersion(body.text, mergeContext(c, body.attachments), answer)] };
    c.turns.push(turn);
    S.drafts.set(c.sessionKey, (S.drafts.get(c.sessionKey) ?? []).filter((d) => d.chatId !== c.id));
    return launch(c, turn, answer, body.text);
  }),

  http.post(`${API}/chats/:id/turns/:tid/regenerate`, ({ params }) => {
    const c = findChat(id(params.id));
    if (!c) return chatNotFound();
    const turn = c.turns.find((t) => t.id === id(params.tid));
    if (!turn) return notFound("Message");
    if (activeRunFor(c.id)) return busy();
    const version = selectedVersion(turn);
    const answer = newAnswer();
    version.answers.push(answer);
    version.selectedAnswer = version.answers.length - 1;
    return launch(c, turn, answer, version.text);
  }),

  http.post(`${API}/chats/:id/turns/:tid/edit`, async ({ params, request }) => {
    const c = findChat(id(params.id));
    if (!c) return chatNotFound();
    const turn = c.turns.find((t) => t.id === id(params.tid));
    if (!turn) return notFound("Message");
    const body = await readJson<Body<"/api/v1/chats/{chat_id}/turns/{turn_id}/edit", "post">>(request);
    if (isEmpty(body)) return empty();
    if (activeRunFor(c.id)) return busy();
    if (turn !== c.turns[c.turns.length - 1]) return problem(409, "not_last_turn", "Only the last message can be edited.");
    const answer = newAnswer();
    turn.versions.push(newVersion(body.text, mergeContext(c, body.attachments), answer));
    turn.selected = turn.versions.length - 1;
    return launch(c, turn, answer, body.text);
  }),

  http.put(`${API}/chats/:id/turns/:tid/selection`, async ({ params, request }) => {
    const c = findChat(id(params.id));
    if (!c) return chatNotFound();
    const turn = c.turns.find((t) => t.id === id(params.tid));
    if (!turn) return notFound("Message");
    if (activeRunFor(c.id)) return busy();
    const body = await readJson<Body<"/api/v1/chats/{chat_id}/turns/{turn_id}/selection", "put">>(request);
    const chosen = turn.versions[body.version];
    if (!chosen || body.answer < 0 || body.answer >= Math.max(1, chosen.answers.length)) {
      return problem(422, "no_such_version", "That version doesn't exist.");
    }
    turn.selected = body.version;
    chosen.selectedAnswer = body.answer;
    c.updatedAt = nowIso();
    return json(view(c));
  }),

  http.post(`${API}/chats/:id/seen`, ({ params }) => {
    const chatId = id(params.id);
    const c = findChat(chatId) ?? findTeacherChat(chatId)?.summary;
    if (c) c.unseenAnswer = false;
    return noContent();
  }),

  http.post(`${API}/chats/:id/answers/:aid/append-to-note`, async ({ params, request }) => {
    const c = findChat(id(params.id));
    if (!c) return chatNotFound();
    const answer = c.turns.flatMap((t) => t.versions.flatMap((v) => v.answers)).find((a) => a.id === id(params.aid));
    if (!answer) return notFound("Answer");
    if (answer.status === "queued" || answer.status === "streaming") return problem(409, "answer_incomplete", "Wait until the answer is complete.");
    return appendAnswer(c, answer, await readJson<Schemas["AppendTarget"]>(request));
  }),

  http.get(`${API}/sessions/:key/chat-drafts`, ({ params }) => json(S.drafts.get(id(params.key)) ?? [])),

  http.put(`${API}/sessions/:key/chat-drafts`, async ({ params, request }) => {
    const key = id(params.key);
    if (!getSession(key)) return notFound("Session");
    const body = await readJson<Body<"/api/v1/sessions/{session_key}/chat-drafts", "put">>(request);
    const chatId = body.chatId ?? null;
    const rest = (S.drafts.get(key) ?? []).filter((d) => d.chatId !== chatId);
    const draft: Draft = { chatId, text: body.text ?? "", attachments: body.attachments ?? [], updatedAt: nowIso() };
    S.drafts.set(key, draft.text || draft.attachments?.length ? [...rest, draft] : rest);
    return json(draft);
  }),

  http.get(`${API}/chat-files/:id`, () => notFound("File")),

  http.get(`${API}/chat-runs/active`, () => json(activeRuns().map(runOut))),

  http.get(`${API}/chat-runs/:id/events`, ({ params, request }) => {
    const run = getRun(id(params.id));
    if (!run) return notFound("Run");
    const raw = new URL(request.url).searchParams.get("lastEventId") ?? request.headers.get("Last-Event-ID") ?? "0";
    return eventStream(run, Number(raw) || 0);
  }),

  http.post(`${API}/chat-runs/:id/stop`, ({ params }) => {
    const run = getRun(id(params.id));
    if (!run) return notFound("Run");
    stopRun(run);
    return json(runOut(run));
  }),
];
