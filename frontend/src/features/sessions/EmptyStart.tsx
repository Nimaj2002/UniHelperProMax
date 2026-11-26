/** The empty main area's single big "+": start a note, PDF, chat, AI Teacher lesson or the audio recorder. */
import { ChatCircleText, FilePdf, GraduationCap, Microphone, NotePencil, Plus, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PDF_ACCEPT } from "@/features/documents/pdfFiles";
import { documentQueue } from "@/features/documents/queue";
import type { TeacherKind } from "@/features/teacher/api";

interface Props {
  sessionKey: string;
  onNewNote: () => void;
  onImportNote: () => void;
  onOpenDocument: (id: string) => void;
  onNewChat: () => void;
  onNewTeacher: (kind: TeacherKind) => void;
  onRecorder: () => void;
}

export function EmptyStart({ sessionKey, onNewNote, onImportNote, onOpenDocument, onNewChat, onNewTeacher, onRecorder }: Props) {
  const [open, setOpen] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const batches = useRef(new Set<string>());
  const openRef = useRef(onOpenDocument);
  useEffect(() => {
    openRef.current = onOpenDocument;
  });
  useEffect(
    () =>
      documentQueue().onEvent((e) => {
        if (e.type === "done" && e.entry.resultId && batches.current.has(e.entry.batchId)) openRef.current(e.entry.resultId);
      }),
    [],
  );
  const pickPdf = () => pdfInput.current?.click();
  return (
    <>
      <button
        type="button"
        data-tour="new-note"
        aria-label="Add to this session"
        title="Add to this session"
        onClick={() => setOpen(true)}
        className="inline-flex size-16 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Plus size={32} weight="bold" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to this session</DialogTitle>
            <DialogDescription>Start a note, open a PDF, chat, learn with the AI Teacher or record audio.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Choice close={() => setOpen(false)} icon={<NotePencil aria-hidden />} label="New note" onPick={onNewNote} />
            <Choice close={() => setOpen(false)} icon={<UploadSimple aria-hidden />} label="Upload note" onPick={onImportNote} />
            <Choice close={() => setOpen(false)} icon={<FilePdf aria-hidden />} label="Upload PDF" onPick={pickPdf} tour="upload-document" />
            <Choice close={() => setOpen(false)} icon={<ChatCircleText aria-hidden />} label="Chat" onPick={onNewChat} />
            <Choice close={() => setOpen(false)} icon={<GraduationCap aria-hidden />} label="AI Teacher lesson" onPick={() => onNewTeacher("lesson")} />
            <Choice close={() => setOpen(false)} icon={<GraduationCap aria-hidden />} label="AI Teacher practice" onPick={() => onNewTeacher("practice")} />
            <Choice close={() => setOpen(false)} icon={<Microphone aria-hidden />} label="Audio recorder" onPick={onRecorder} />
          </div>
        </DialogContent>
      </Dialog>
      <input
        ref={pdfInput}
        type="file"
        multiple
        accept={PDF_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) batches.current.add(documentQueue().enqueue(sessionKey, files));
        }}
      />
    </>
  );
}

function Choice({ icon, label, onPick, close, tour }: { icon: ReactNode; label: string; onPick: () => void; close: () => void; tour?: string }) {
  return (
    <Button
      variant="outline"
      className="justify-start"
      data-tour={tour}
      onClick={() => {
        close();
        onPick();
      }}
    >
      {icon} {label}
    </Button>
  );
}
