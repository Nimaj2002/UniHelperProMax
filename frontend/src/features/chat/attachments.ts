/**
 * 014 US6/US8: what a message box's attachments look like — a module store, shared by the box,
 * its Attach menu and the note picker, of titles and types per attachment (the draft itself only
 * keeps `{kind, ref, pdfMode}`), uploads in progress per draft, and the last refusal to show.
 * Adding goes through `addAttachments`, which keeps the 10-per-message cap (FR-055).
 */
import { useSyncExternalStore } from "react";
import { isApiError } from "@/lib/api";
import { attachmentKey, isNewChatId, MAX_ATTACHMENTS, uploadChatFile, type ChatUpload, type ContextItemRef } from "./api";
import { getDraft, setDraft } from "./drafts";

export interface AttachmentMeta {
  title: string;
  mime?: string | null;
  /** False when a referenced note, document or recording no longer exists. */
  available?: boolean;
}

export interface UploadInProgress {
  id: string;
  name: string;
  loaded: number;
  total: number;
  abort: () => void;
}

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const PDF_ACCEPT = "application/pdf,.pdf";
export const AUDIO_ACCEPT = "audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm";
export const CAP_MESSAGE = `At most ${MAX_ATTACHMENTS} attachments per message.`;

const meta = new Map<string, AttachmentMeta>();
const uploads = new Map<string, UploadInProgress[]>();
const messages = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const draftKey = (sessionKey: string, chatId: string | null) => `${sessionKey}\n${isNewChatId(chatId) ? "" : chatId}`;
const NO_UPLOADS: UploadInProgress[] = [];

/** Remember titles and types (from a picker, an upload, a chat's context or a preflight). */
export function rememberMeta(items: ({ kind: ContextItemRef["kind"]; ref: string } & AttachmentMeta)[]) {
  let changed = false;
  for (const i of items) {
    const key = attachmentKey(i);
    const cur = meta.get(key);
    const next = { title: i.title, mime: i.mime ?? cur?.mime, available: i.available ?? cur?.available };
    if (!cur || cur.title !== next.title || cur.mime !== next.mime || cur.available !== next.available) {
      meta.set(key, next);
      changed = true;
    }
  }
  if (changed) notify();
}

export const metaOf = (a: Pick<ContextItemRef, "kind" | "ref">): AttachmentMeta | undefined => meta.get(attachmentKey(a));

export function setAttachMessage(sessionKey: string, chatId: string | null, message: string | null) {
  const key = draftKey(sessionKey, chatId);
  if ((messages.get(key) ?? null) === message) return;
  if (message) messages.set(key, message);
  else messages.delete(key);
  notify();
}

/** Room left in this message for new attachments (uploads in progress count). */
export function roomLeft(sessionKey: string, chatId: string | null): number {
  return MAX_ATTACHMENTS - getDraft(sessionKey, chatId).attachments.length - (uploads.get(draftKey(sessionKey, chatId))?.length ?? 0);
}

/** Add attachments to the draft; returns how many were added (the rest went over the cap). */
export function addAttachments(sessionKey: string, chatId: string | null, refs: (ContextItemRef & Partial<AttachmentMeta>)[]): number {
  const draft = getDraft(sessionKey, chatId);
  const have = new Set(draft.attachments.map(attachmentKey));
  const fresh = refs.filter((r) => !have.has(attachmentKey(r)));
  const room = Math.max(0, roomLeft(sessionKey, chatId));
  const taken = fresh.slice(0, room);
  rememberMeta(taken.filter((r) => r.title).map((r) => ({ kind: r.kind, ref: r.ref, title: r.title!, mime: r.mime, available: true })));
  if (taken.length)
    setDraft(sessionKey, chatId, { ...getDraft(sessionKey, chatId), attachments: [...draft.attachments, ...taken.map(({ kind, ref, pdfMode }) => (pdfMode ? { kind, ref, pdfMode } : { kind, ref }))] });
  setAttachMessage(sessionKey, chatId, fresh.length > taken.length ? CAP_MESSAGE : null);
  return taken.length;
}

export function removeAttachment(sessionKey: string, chatId: string | null, a: Pick<ContextItemRef, "kind" | "ref">) {
  const draft = getDraft(sessionKey, chatId);
  setDraft(sessionKey, chatId, { ...draft, attachments: draft.attachments.filter((x) => attachmentKey(x) !== attachmentKey(a)) });
  setAttachMessage(sessionKey, chatId, null);
}

/** Change one attachment (e.g. send a PDF's text instead: `pdfMode: "text"`). */
export function updateAttachment(sessionKey: string, chatId: string | null, a: ContextItemRef) {
  const draft = getDraft(sessionKey, chatId);
  setDraft(sessionKey, chatId, { ...draft, attachments: draft.attachments.map((x) => (attachmentKey(x) === attachmentKey(a) ? a : x)) });
}

function uploadError(err: unknown, name: string): string {
  if (isApiError(err, "unsupported_type")) return `${name} isn't a supported picture, PDF or audio file.`;
  if (isApiError(err) && err.status === 413) return `${name} is too large: files can be at most 25 MB.`;
  if (isApiError(err) && err.status === 0) return `Couldn't upload ${name}. Check your connection.`;
  return `Couldn't upload ${name}.`;
}

/** Upload files from the device (picker, paste or drop) and attach each when it is stored. */
export function uploadAttachments(sessionKey: string, chatId: string | null, files: File[], onUploaded?: (u: ChatUpload) => void) {
  const key = draftKey(sessionKey, chatId);
  const room = Math.max(0, roomLeft(sessionKey, chatId));
  const taken = files.slice(0, room);
  setAttachMessage(sessionKey, chatId, files.length > taken.length ? CAP_MESSAGE : null);
  for (const file of taken) {
    const ctrl = new AbortController();
    const entry: UploadInProgress = { id: crypto.randomUUID(), name: file.name || "Pasted picture", loaded: 0, total: file.size, abort: () => ctrl.abort() };
    const update = (fn: (u: UploadInProgress) => UploadInProgress | null) => {
      const list = (uploads.get(key) ?? []).flatMap((u) => (u.id === entry.id ? (fn(u) ?? []) : [u]));
      if (list.length) uploads.set(key, list);
      else uploads.delete(key);
      notify();
    };
    uploads.set(key, [...(uploads.get(key) ?? []), entry]);
    notify();
    void uploadChatFile(sessionKey, file, (loaded, total) => update((u) => ({ ...u, loaded, total })), ctrl.signal).then(
      (u) => {
        update(() => null);
        rememberMeta([{ kind: "upload", ref: u.id, title: u.name, mime: u.mime, available: true }]);
        const draft = getDraft(sessionKey, chatId);
        setDraft(sessionKey, chatId, { ...draft, attachments: [...draft.attachments, { kind: "upload", ref: u.id }] });
        onUploaded?.(u);
      },
      (err: unknown) => {
        update(() => null);
        if ((err as Error)?.name !== "AbortError") setAttachMessage(sessionKey, chatId, uploadError(err, entry.name));
      },
    );
  }
}

export function useAttachState(sessionKey: string, chatId: string | null) {
  useSyncExternalStore(subscribe, () => version, () => version);
  const key = draftKey(sessionKey, chatId);
  return { uploads: uploads.get(key) ?? NO_UPLOADS, message: messages.get(key) ?? null };
}

/** Re-render on title/type changes (chips). */
export function useAttachMeta() {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** Tests: forget everything. */
export function resetAttachments() {
  meta.clear();
  uploads.clear();
  messages.clear();
  notify();
}
