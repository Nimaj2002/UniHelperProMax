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
import type { Recording } from "./api";

export function RenameRecordingDialog({ recording, onSubmit, onClose }: { recording: Recording; onSubmit: (name: string) => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = useState(recording.name);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a name.");
    setBusy(true);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(isApiError(err) ? (err.fieldMessage("/name") ?? err.title) : "Couldn't rename. Please retry.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename recording</DialogTitle>
          <DialogDescription>The audio file is renamed too.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field label="Recording name" error={error}>
            <Input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>Rename</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRecordingDialog({ recording, onConfirm, onClose }: { recording: Recording; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{recording.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The audio file <span className="font-medium text-foreground">{recording.fileName}</span> is removed from this
            session's audios folder. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep recording</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } catch (err) {
                setError(isApiError(err) ? err.title : "Couldn't delete. Please retry.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete recording
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
