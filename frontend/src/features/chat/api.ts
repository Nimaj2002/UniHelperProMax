/** 014 US3/US4: the chat API — chats, messages, versions, runs, seen and drafts. */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { API_BASE, apiFetch, isApiError, type Schemas } from "@/lib/api";
import { uploadFile } from "@/lib/api/upload";

export type ChatSummary = Schemas["ChatSummary"];
export type Chat = Schemas["ChatOut"];
export type Turn = Schemas["TurnOut"];
export type UserVersion = Schemas["UserVersionOut"];
export type Answer = Schemas["AnswerOut"];
export type AnswerError = Schemas["AnswerError"];
export type ModelRef = Schemas["ModelRef"];
export type SendResult = Schemas["SendResult"];
export type ChatRun = Schemas["ChatRunOut"];
export type ChatDraft = Schemas["ChatDraftIo"];
export type ContextItemRef = Schemas["ContextItemRef"];
export type ChatUsage = Schemas["Usage"];
export type ContextItem = Schemas["ContextItem"];
export type NoteSearchHit = Schemas["NoteSearchHit"];
export type ChatUpload = Schemas["ChatUploadOut"];
export type Preflight = Schemas["PreflightResult"];
export type PreflightItem = Schemas["PreflightItem"];
export type AppendResult = Schemas["unihelper__schemas__chat__AppendResult"];
/** One refused attachment in a 409 `attachment_not_accepted` problem. */
export interface Unaccepted {
  kind: ContextItemRef["kind"];
  ref: string;
  reasonCode?: string | null;
  reason?: string | null;
}

/** FR-055: at most this many attachments per message (the server says 422 `too_many_attachments`). */
export const MAX_ATTACHMENTS = 10;
export const attachmentKey = (a: Pick<ContextItemRef, "kind" | "ref">) => `${a.kind}:${a.ref}`;

export interface SendBody {
  text: string;
  model: ModelRef;
  attachments?: ContextItemRef[];
}

export const chatKey = (id: string) => ["chat", id] as const;
export const chatsKey = (sessionKey: string, q = "") => ["chats", sessionKey, q] as const;
export const chatsOfSession = (sessionKey: string) => ["chats", sessionKey] as const;
export const activeRunsKey = ["chat-runs-active"] as const;
export const draftsKey = (sessionKey: string) => ["chat-drafts", sessionKey] as const;

const enc = encodeURIComponent;
const chatPath = (id: string) => `/chats/${enc(id)}`;

/** A placeholder id of a chat tab that has no chat yet (the server keeps `new:<uuid>` tab ids). */
export const isNewChatId = (id: string | null | undefined): boolean => !id || id.startsWith("new:");
export const newChatId = () => `new:${crypto.randomUUID()}`;

// ---- requests ---------------------------------------------------------------------------------

export const fetchChat = (id: string) => apiFetch<Chat>(chatPath(id));
export type ChatSearchIn = "title" | "text";
export const listChats = (sessionKey: string, q = "", signal?: AbortSignal, searchIn: ChatSearchIn = "title") =>
  apiFetch<ChatSummary[]>(`/sessions/${enc(sessionKey)}/chats`, { query: { q, in: q ? searchIn : undefined }, signal });
export const startChat = (sessionKey: string, body: SendBody) =>
  apiFetch<SendResult>(`/sessions/${enc(sessionKey)}/chats`, { method: "POST", body });
export const sendMessage = (chatId: string, body: SendBody) =>
  apiFetch<SendResult>(`${chatPath(chatId)}/messages`, { method: "POST", body });
export const regenerate = (chatId: string, turnId: string, model?: ModelRef) =>
  apiFetch<SendResult>(`${chatPath(chatId)}/turns/${enc(turnId)}/regenerate`, { method: "POST", body: model ? { model } : {} });
/** FR-059: edit and resend the last message (409 `not_last_turn` for an earlier one). */
export const editTurn = (chatId: string, turnId: string, body: SendBody) =>
  apiFetch<SendResult>(`${chatPath(chatId)}/turns/${enc(turnId)}/edit`, { method: "POST", body });
/** FR-058: append an answer to a note, or to a new note (409 `answer_incomplete` while it streams). */
export const appendToNote = (chatId: string, answerId: string, target: { noteId: string } | { newNoteTitle: string }) =>
  apiFetch<AppendResult>(`${chatPath(chatId)}/answers/${enc(answerId)}/append-to-note`, { method: "POST", body: target });
export const preflight = (body: Schemas["PreflightRequest"], signal?: AbortSignal) =>
  apiFetch<Preflight>("/chats/preflight", { method: "POST", body, signal });
export const searchNotes = (q: string, courseId: string | null, signal?: AbortSignal, limit = 30) =>
  apiFetch<NoteSearchHit[]>("/notes/search", { query: { q, courseId, limit }, signal });
/** A raw upload (like the document import); 415 `unsupported_type`, 413 `file_too_large`. */
export const uploadChatFile = (sessionKey: string, file: File, onProgress: (loaded: number, total: number) => void, signal: AbortSignal) =>
  uploadFile<ChatUpload>(`/sessions/${enc(sessionKey)}/chat-uploads`, { fileName: file.name || "pasted" }, file, onProgress, signal);
export const chatFileUrl = (uploadId: string) => `${API_BASE}/chat-files/${enc(uploadId)}`;
export const selectVersion = (chatId: string, turnId: string, version: number, answer: number) =>
  apiFetch<Chat>(`${chatPath(chatId)}/turns/${enc(turnId)}/selection`, { method: "PUT", body: { version, answer } });
export const stopRun = (runId: string) => apiFetch<ChatRun>(`/chat-runs/${enc(runId)}/stop`, { method: "POST" });
export const fetchActiveRuns = () => apiFetch<ChatRun[]>("/chat-runs/active");
export const markSeen = (chatId: string) => apiFetch<void>(`${chatPath(chatId)}/seen`, { method: "POST" });
export const updateChat = (chatId: string, version: number, body: Schemas["ChatUpdate"]) =>
  apiFetch<Chat>(chatPath(chatId), { method: "PATCH", body, version });
/** PATCH with the cached version; once more with a fresh one when it changed meanwhile (seen, a run's end). */
export async function updateChatFresh(chatId: string, version: number, body: Schemas["ChatUpdate"]): Promise<Chat> {
  try {
    return await updateChat(chatId, version, body);
  } catch (err) {
    if (!isApiError(err, "version_conflict")) throw err;
    return updateChat(chatId, (await fetchChat(chatId)).version, body);
  }
}
export const deleteChat = (chatId: string, version: number) => apiFetch<void>(chatPath(chatId), { method: "DELETE", version });
export async function deleteChatFresh(chatId: string, version: number): Promise<void> {
  try {
    await deleteChat(chatId, version);
  } catch (err) {
    if (!isApiError(err, "version_conflict")) throw err;
    await deleteChat(chatId, (await fetchChat(chatId)).version);
  }
}
export const restoreChat = (chatId: string) => apiFetch<ChatSummary>(`${chatPath(chatId)}/restore`, { method: "POST" });
export const fetchDrafts = (sessionKey: string) => apiFetch<ChatDraft[]>(`/sessions/${enc(sessionKey)}/chat-drafts`);
export const putDraft = (sessionKey: string, draft: ChatDraft, keepalive = false) =>
  apiFetch<ChatDraft>(`/sessions/${enc(sessionKey)}/chat-drafts`, { method: "PUT", body: draft, keepalive });

// ---- queries ----------------------------------------------------------------------------------

export function useChat(id: string | null | undefined) {
  return useQuery({ queryKey: chatKey(id ?? ""), queryFn: () => fetchChat(id!), enabled: !isNewChatId(id) });
}

/** The session's chats, newest first; `q` filters by title (or by message text, FR-062). */
export function useChats(sessionKey: string, q = "", searchIn: ChatSearchIn = "title") {
  return useQuery({
    queryKey: searchIn === "text" && q ? [...chatsKey(sessionKey, q), "text"] : chatsKey(sessionKey, q),
    queryFn: ({ signal }) => listChats(sessionKey, q, signal, searchIn),
    enabled: !!sessionKey,
    placeholderData: (prev) => prev,
  });
}

export function useActiveRuns() {
  return useQuery({ queryKey: activeRunsKey, queryFn: fetchActiveRuns });
}

/** After a run changes a chat: its conversation and its session's lists. */
export function invalidateChat(qc: QueryClient, chatId: string, sessionKey?: string) {
  void qc.invalidateQueries({ queryKey: chatKey(chatId) });
  void qc.invalidateQueries({ queryKey: sessionKey ? chatsOfSession(sessionKey) : ["chats"] });
}

// ---- mutations --------------------------------------------------------------------------------

export function useSelectVersion(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ turnId, version, answer }: { turnId: string; version: number; answer: number }) =>
      selectVersion(chatId, turnId, version, answer),
    onSuccess: (chat) => qc.setQueryData(chatKey(chatId), chat),
  });
}

export function useUpdateChat(sessionKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, body }: { id: string; version: number; body: Schemas["ChatUpdate"] }) => updateChatFresh(id, version, body),
    onSuccess: (chat) => {
      qc.setQueryData(chatKey(chat.id), chat);
      void qc.invalidateQueries({ queryKey: chatsOfSession(sessionKey) });
    },
  });
}
