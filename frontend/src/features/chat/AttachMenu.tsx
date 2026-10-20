/**
 * 014 US6/US8 FR-046/FR-052/FR-054 (contracts/ui-contract.md "Message box"): the message box's
 * Attach menu — Notes… (the note picker), Pictures… (from the device), PDFs (the session's
 * documents or an upload) and Audio (the session's recordings or an upload). Audio is
 * `aria-disabled` with its reason when the model doesn't accept it. Focus goes back to the
 * message box when the menu or the picker closes.
 */
import { FilePdf, Image as ImageIcon, Microphone, NotePencil, Plus, UploadSimple } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDocuments } from "@/features/documents/api";
import { useRecordings } from "@/features/recordings/api";
import type { AiCapabilities } from "@/features/settings/ai/api";
import { attachmentKey } from "./api";
import { addAttachments, AUDIO_ACCEPT, IMAGE_ACCEPT, PDF_ACCEPT, roomLeft, uploadAttachments } from "./attachments";
import { useDraftAttachments } from "./drafts";
import { useOpenNoteId } from "./chatPlacement";
import { NotePicker } from "./NotePicker";

export const NO_AUDIO_REASON = "This model doesn't accept audio — use Transcribe on the recording";

export interface AttachMenuProps {
  sessionKey: string;
  chatId: string | null;
  /** The chosen model's capabilities (Audio needs `audio`). */
  capabilities?: AiCapabilities;
  disabled?: boolean;
  /** Give focus back to the message box when the menu closes. */
  onClosed?: () => void;
}

export function AttachMenu({ sessionKey, chatId, capabilities, disabled, onClosed }: AttachMenuProps) {
  const draftAttachments = useDraftAttachments(sessionKey, chatId);
  const openNoteId = useOpenNoteId(sessionKey);
  const [picking, setPicking] = useState(false);
  const documents = useDocuments(sessionKey);
  const recordings = useRecordings(sessionKey);
  const images = useRef<HTMLInputElement>(null);
  const pdfs = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  // a menu item that opens something else must not take the focus back to the box
  const keepFocus = useRef(false);
  const noAudio = !capabilities?.audio;
  const attachedNotes = new Set(draftAttachments.filter((a) => a.kind === "note").map((a) => a.ref));
  const attached = new Set(draftAttachments.map(attachmentKey));

  const docs = (documents.data ?? []).filter((d) => !d.missing);
  const recs = (recordings.data ?? []).filter((r) => !r.missing && r.status !== "recording");

  const pickFiles = (input: React.RefObject<HTMLInputElement | null>) => {
    keepFocus.current = true;
    // open the file chooser once the menu has closed
    requestAnimationFrame(() => input.current?.click());
  };

  const fileInput = (ref: React.RefObject<HTMLInputElement | null>, accept: string, testId: string) => (
    <input
      ref={ref}
      type="file"
      multiple
      accept={accept}
      className="hidden"
      tabIndex={-1}
      aria-hidden
      data-testid={testId}
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        if (files.length) uploadAttachments(sessionKey, chatId, files);
        onClosed?.();
      }}
    />
  );

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button
                type="button"
                aria-label="Attach"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus size={16} aria-hidden />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Attach notes, pictures, PDFs or audio</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-60"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (keepFocus.current) keepFocus.current = false;
            else onClosed?.();
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              keepFocus.current = true;
              setPicking(true);
            }}
          >
            <NotePencil aria-hidden /> Notes…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pickFiles(images)}>
            <ImageIcon aria-hidden /> Pictures…
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FilePdf aria-hidden /> PDFs
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-64 overflow-y-auto">
              {docs.map((d) => (
                <DropdownMenuItem
                  key={d.id}
                  disabled={attached.has(`document:${d.id}`) || d.encrypted}
                  onSelect={() => addAttachments(sessionKey, chatId, [{ kind: "document", ref: d.id, title: d.name, mime: "application/pdf" }])}
                >
                  <FilePdf aria-hidden />
                  <span className="min-w-0 truncate">{d.name}</span>
                </DropdownMenuItem>
              ))}
              {!docs.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No PDFs in this session.</p>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => pickFiles(pdfs)}>
                <UploadSimple aria-hidden /> Upload from device
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {noAudio ? (
            <DropdownMenuItem aria-label="Audio" aria-describedby={reasonId} aria-disabled onSelect={(e) => e.preventDefault()} className="cursor-not-allowed items-start opacity-70">
              <Microphone aria-hidden className="mt-0.5" />
              <span className="grid min-w-0 gap-0.5">
                <span>Audio</span>
                <span id={reasonId} className="text-xs text-muted-foreground">
                  {NO_AUDIO_REASON}
                </span>
              </span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Microphone aria-hidden /> Audio
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-64 overflow-y-auto">
                {recs.map((r) => (
                  <DropdownMenuItem
                    key={r.id}
                    disabled={attached.has(`recording:${r.id}`)}
                    onSelect={() => addAttachments(sessionKey, chatId, [{ kind: "recording", ref: r.id, title: r.name, mime: r.mimeType }])}
                  >
                    <Microphone aria-hidden />
                    <span className="min-w-0 truncate">{r.name}</span>
                  </DropdownMenuItem>
                ))}
                {!recs.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No recordings in this session.</p>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => pickFiles(audio)}>
                  <UploadSimple aria-hidden /> Upload from device
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {fileInput(images, IMAGE_ACCEPT, "chat-attach-pictures")}
      {fileInput(pdfs, PDF_ACCEPT, "chat-attach-pdfs")}
      {fileInput(audio, AUDIO_ACCEPT, "chat-attach-audio")}
      <NotePicker
        open={picking}
        onOpenChange={setPicking}
        onClosed={onClosed}
        sessionKey={sessionKey}
        openNoteId={openNoteId}
        room={roomLeft(sessionKey, chatId)}
        attached={attachedNotes}
        onPick={(notes) => addAttachments(sessionKey, chatId, notes.map((n) => ({ kind: "note", ref: n.id, title: n.title })))}
      />
    </>
  );
}
