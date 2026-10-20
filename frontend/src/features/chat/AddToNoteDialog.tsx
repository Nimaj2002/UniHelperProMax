/**
 * 014 US10 FR-058: "Add to note" — append an answer to one of the session's notes, or to a new
 * note, after its last character under a heading naming the chat and the date (the server's
 * transcript path, never overwriting). An open note editor merges the appended text the way a
 * finished transcription does (`applyServerAppend`), so there is no conflict; a toast offers
 * "Open note".
 */
import { NotePencil, Plus } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notesKey, noteKey, useNotes } from "@/features/sessions/api";
import { getSaver } from "@/features/sessions/autosave";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { appendToNote, type AppendResult } from "./api";

interface Props {
  sessionKey: string;
  chatId: string;
  answerId: string | null;
  chatTitle: string;
  onOpenChange: (open: boolean) => void;
  /** Focus back to the answer's button. */
  onClosed?: () => void;
}

const NEW = "__new";

/** Merge into an open editor (as transcription appends do), else refresh the cached note. */
export function mergeAppend(qc: ReturnType<typeof useQueryClient>, sessionKey: string, res: AppendResult) {
  const saver = getSaver(res.noteId);
  if (saver && res.previousHash) saver.applyServerAppend({ text: res.text, previousHash: res.previousHash, hash: res.hash, version: res.version });
  else void qc.invalidateQueries({ queryKey: noteKey(res.noteId) });
  void qc.invalidateQueries({ queryKey: notesKey(sessionKey) });
}

export function AddToNoteDialog({ sessionKey, chatId, answerId, chatTitle, onOpenChange, onClosed }: Props) {
  const qc = useQueryClient();
  const notes = useNotes(sessionKey);
  const navigate = useNavigate();
  const location = useLocation();
  const [choice, setChoice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (choice === NEW) nameInput.current?.focus();
  }, [choice]);
  const list = notes.data ?? [];
  const open = !!answerId;

  const close = () => {
    setChoice(null);
    setTitle("");
    setError(undefined);
    onOpenChange(false);
  };

  const submit = async () => {
    if (!answerId || !choice) return;
    const newTitle = title.trim() || chatTitle;
    setBusy(true);
    setError(undefined);
    try {
      const res = await appendToNote(chatId, answerId, choice === NEW ? { newNoteTitle: newTitle } : { noteId: choice });
      mergeAppend(qc, sessionKey, res);
      const name = choice === NEW ? newTitle : (list.find((n) => n.id === choice)?.name ?? "the note");
      close();
      toast(`Added to “${name}”`, {
        duration: 10_000,
        action: { label: "Open note", onClick: () => navigate(`${location.pathname}?note=${encodeURIComponent(res.noteId)}`) },
      });
    } catch (err) {
      setError(
        isApiError(err, "answer_incomplete")
          ? "Wait until the answer is complete."
          : isApiError(err, "name_taken")
            ? "A note with this name already exists."
            : isApiError(err)
              ? (err.detail ?? err.title)
              : "Couldn't add the answer to the note.",
      );
    } finally {
      setBusy(false);
    }
  };

  const option = (id: string, label: React.ReactNode, icon: React.ReactNode) => (
    <li key={id}>
      <label
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover",
          choice === id && "bg-surface-hover",
        )}
      >
        <input type="radio" name="add-to-note" value={id} checked={choice === id} onChange={() => setChoice(id)} className="accent-primary" />
        {icon}
        <span className="min-w-0 truncate">{label}</span>
      </label>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(e) => {
          if (onClosed) {
            e.preventDefault();
            onClosed();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Add to note</DialogTitle>
          <DialogDescription>The answer is added at the end of the note, under a heading with this chat's name and the date.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="grid gap-1">
            <legend className="sr-only">Note</legend>
            <ul className="grid max-h-60 gap-0.5 overflow-y-auto" aria-label="Notes">
              {list.map((n) => option(n.id, n.name, <NotePencil size={14} aria-hidden className="shrink-0 text-muted-foreground" />))}
              {option(NEW, "New note…", <Plus size={14} aria-hidden className="shrink-0 text-muted-foreground" />)}
            </ul>
          </fieldset>
          {choice === NEW && (
            <Input aria-label="New note name" placeholder={chatTitle} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} ref={nameInput} />
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!choice || busy}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
