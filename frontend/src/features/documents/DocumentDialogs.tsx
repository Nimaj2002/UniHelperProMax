/** Rename and delete a document (007 FR-009/FR-010, contracts/ui-reader.md). */
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
import type { Document } from "./api";

const MAX = 120;

/** Live checks as the user types: empty, too long, or another document's name in this session. */
export function renameProblem(name: string, others: string[]): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name.";
  if (trimmed.length > MAX) return `Use at most ${MAX} characters.`;
  const key = trimmed.toLocaleLowerCase();
  if (others.some((o) => o.toLocaleLowerCase() === key)) return "A document with this name already exists in this session.";
  return undefined;
}

export function RenameDocumentDialog({ doc, others, onSubmit, onClose }: { doc: Document; others: string[]; onSubmit: (name: string) => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = useState(doc.name);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [pending, setPending] = useState(false);
  const problem = renameProblem(name, others);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    if (name.trim() === doc.name) return onClose();
    setPending(true);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setServerError(
        isApiError(err, "version_conflict") ? "The document changed meanwhile. Reload and try again." : isApiError(err) ? (err.fieldMessage("/name") ?? err.title) : "Couldn't rename. Please retry.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename document</DialogTitle>
          <DialogDescription>The PDF and its annotations file are renamed too.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field label="Document name" error={(touched || name !== doc.name ? problem : undefined) ?? serverError}>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setServerError(undefined);
              }}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>Rename</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Every session of the course (or occurrence of the event) lists the PDF, so it goes from all of them (017 FR-009). */
export function deleteText(doc: Document, scope: "course" | "event" = "course"): string {
  const n = doc.annotationCount;
  const annotations = n === 0 ? "" : n === 1 ? " Its annotation is deleted too." : ` Its ${n} annotations are deleted too.`;
  const others = scope === "event" ? "the event's other occurrences" : "the course's other sessions";
  return `The PDF is removed from this session's documents folder.${annotations} It is also listed in ${others} and will disappear from all of them. This can't be undone.`;
}

export function DeleteDocumentDialog({
  doc,
  scope = "course",
  onConfirm,
  onClose,
}: {
  doc: Document;
  scope?: "course" | "event";
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{doc.name}”?</AlertDialogTitle>
          <AlertDialogDescription>{deleteText(doc, scope)}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep document</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
              } catch (err) {
                setError(
                  isApiError(err, "version_conflict")
                    ? "The document changed meanwhile. Reload and try again."
                    : isApiError(err, "not_owning_session")
                      ? err.title
                      : "Couldn't delete the document.",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            Delete document
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
