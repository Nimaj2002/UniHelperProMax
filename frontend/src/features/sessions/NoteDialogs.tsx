import { useState, type FormEvent } from "react";
import { Field } from "@/components/form/Field";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";

interface NameDialogProps {
  title: string;
  description: string;
  submitLabel: string;
  initial?: string;
  pending: boolean;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}

/** Name a new note or rename one (1–120 characters, unique in the session). */
export function NoteNameDialog({ title, description, submitLabel, initial = "", pending, onSubmit, onClose }: NameDialogProps) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a name for the note.");
    if (trimmed.length > 120) return setError("Use at most 120 characters.");
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(isApiError(err) ? (err.fieldMessage("/name") ?? err.title) : "Couldn't save. Please retry.");
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field label="Note name" error={error}>
            <Input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{submitLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteNoteDialog({
  name, fileName, pending, error, onConfirm, onClose,
}: { name: string; fileName: string; pending: boolean; error?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The file <span className="font-medium text-foreground">{fileName}</span> is removed from this session's notes
            folder. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep note</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>Delete note</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
