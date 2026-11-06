/** 022: the AI Teacher API — lesson and practice chats, answers, disputes, hints, idea sets. */
import { useQuery } from "@tanstack/react-query";
import { apiFetch, isApiError, type Schemas } from "@/lib/api";

export type TeacherKind = Schemas["TeacherChatSummary"]["kind"];
export type TeacherSummary = Schemas["TeacherChatSummary"];
export type TeacherChat = Schemas["TeacherChatOut"];
export type TeacherTurn = Schemas["TeacherTurnOut"];
export type Segment = Schemas["SegmentOut"];
export type Question = Schemas["QuestionOut"];
export type Plan = Schemas["PlanOut"];
export type Idea = Schemas["IdeaSummary"];
export type SendResult = Schemas["TeacherSendResult"];
export type ModelRef = Schemas["ModelRef"];
export type ContextItemRef = Schemas["ContextItemRef"];
export type Confidence = 0 | 25 | 50 | 75 | 100;
export interface AnswerInput {
  questionId: string;
  choice?: number;
  text?: string;
  dontKnow?: boolean;
  confidence: Confidence | null;
  thinking: string;
}

const enc = encodeURIComponent;
const path = (id: string) => `/teacher-chats/${enc(id)}`;

export const teacherListKey = (sessionKey: string) => ["teacher", sessionKey] as const;
export const teacherChatKey = (id: string) => ["teacher-chat", id] as const;

/** A teacher tab that has no chat yet: `new:<kind>-<uuid>` (the server keeps `new:` tab ids). */
export const newTeacherId = (kind: TeacherKind) => `new:${kind}-${crypto.randomUUID()}`;
export const isNewTeacherId = (id: string | null | undefined) => !id || id.startsWith("new:");
export const kindOfNew = (id: string): TeacherKind => (id.startsWith("new:practice") ? "practice" : "lesson");
/** The draft key of the new-chat box (the server allows these two). */
export const newDraftKey = (kind: TeacherKind) => `teacher:${kind}`;

export const listTeacherChats = (sessionKey: string) => apiFetch<TeacherSummary[]>(`/sessions/${enc(sessionKey)}/teacher-chats`);
export const fetchTeacherChat = (id: string) => apiFetch<TeacherChat>(path(id));
export const startTeacherChat = (
  sessionKey: string,
  body: { kind: TeacherKind; text: string; model: ModelRef; attachments?: ContextItemRef[]; topic?: string | null; ideaIds?: string[] | null },
) => apiFetch<SendResult>(`/sessions/${enc(sessionKey)}/teacher-chats`, { method: "POST", body });
export const sendTeacherMessage = (id: string, body: { text: string; model: ModelRef; attachments?: ContextItemRef[] }) =>
  apiFetch<SendResult>(`${path(id)}/messages`, { method: "POST", body });
export const submitAnswers = (id: string, model: ModelRef, answers: AnswerInput[]) =>
  apiFetch<SendResult>(`${path(id)}/answers`, { method: "POST", body: { model, answers } });
export const disputeGrade = (id: string, questionId: string, model: ModelRef, reason: string) =>
  apiFetch<SendResult>(`${path(id)}/questions/${enc(questionId)}/dispute`, { method: "POST", body: { model, reason } });
export const askHint = (id: string, questionId: string, model: ModelRef, attempt: string) =>
  apiFetch<SendResult>(`${path(id)}/questions/${enc(questionId)}/hint`, { method: "POST", body: { model, attempt } });
export const revealSolution = (id: string, questionId: string) =>
  apiFetch<Question>(`${path(id)}/questions/${enc(questionId)}/reveal`, { method: "POST" });
export const retryMalformed = (id: string, segmentId: string, model: ModelRef) =>
  apiFetch<SendResult>(`${path(id)}/malformed/${enc(segmentId)}/retry`, { method: "POST", body: { model } });
export const putIdeaSet = (id: string, ideaIds: string[]) =>
  apiFetch<Idea[]>(`${path(id)}/idea-set`, { method: "PUT", body: { ideaIds } });
export const requestGraphUpdate = (id: string) => apiFetch<Schemas["GraphStatus"]>(`${path(id)}/graph-update`, { method: "POST" });
export const graphImpact = (id: string) => apiFetch<{ ideas: number }>(`${path(id)}/graph-impact`);
export const renameTeacherChat = (id: string, version: number, title: string) =>
  apiFetch<TeacherSummary>(path(id), { method: "PATCH", body: { title }, version });
export const deleteTeacherChat = (id: string, version: number) => apiFetch<void>(`/chats/${enc(id)}`, { method: "DELETE", version });
export const restoreTeacherChat = (id: string) => apiFetch<unknown>(`/chats/${enc(id)}/restore`, { method: "POST" });
export const fetchInstructions = () => apiFetch<Schemas["Instructions"]>("/teacher/instructions");

/** PATCH/DELETE with the cached version; once more with a fresh one when a run's end bumped it. */
export async function withFreshVersion<T>(sessionKey: string, id: string, version: number, call: (v: number) => Promise<T>): Promise<T> {
  try {
    return await call(version);
  } catch (err) {
    if (!isApiError(err, "version_conflict")) throw err;
    const fresh = (await listTeacherChats(sessionKey)).find((c) => c.id === id);
    return call(fresh?.version ?? version);
  }
}

export function useTeacherChats(sessionKey: string) {
  return useQuery({ queryKey: teacherListKey(sessionKey), queryFn: () => listTeacherChats(sessionKey), enabled: !!sessionKey });
}

export function useTeacherChat(id: string | null) {
  return useQuery({ queryKey: teacherChatKey(id ?? ""), queryFn: () => fetchTeacherChat(id!), enabled: !isNewTeacherId(id) });
}
