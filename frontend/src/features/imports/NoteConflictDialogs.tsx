import { useId, useRef, useState, type FormEvent } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_NOTE_NAME, nameKey } from "./noteFiles";
import type { ConflictChoice, ConflictPrompt } from "./noteImport";

interface ConflictProps {
  prompt: ConflictPrompt;
  onChoose: (choice: ConflictChoice, applyToAll: boolean) => void;
}

/** A note with this name exists: the user decides; closing or Escape means Skip (FR-018). */
export function NoteConflictDialog({ prompt, onChoose }: ConflictProps) {
  const [name, setName] = useState(prompt.suggestion);
  const [all, setAll] = useState(false);
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const allId = useId();
  const trimmed = name.trim();
  const problem = !trimmed
    ? "Enter a name for the note."
    : [...trimmed].length > MAX_NOTE_NAME
      ? "Use at most 120 characters."
      : prompt.takenKeys.has(nameKey(trimmed))
        ? "A note with this name already exists in this session."
        : null;

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (!problem) onChoose({ action: "rename", name: trimmed }, all);
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onChoose({ action: "skip" }, false)}>
      <AlertDialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault(); // start on the name field (contracts/ui-import.md)
          field.current?.focus();
          field.current?.select();
        }}
      >
        <form onSubmit={rename} noValidate className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>A note named “{prompt.name}” already exists</AlertDialogTitle>
            <AlertDialogDescription>
              What should happen to <span className="font-medium text-foreground">{prompt.fileName}</span>? The existing note stays
              as it is unless you choose Replace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={fieldId}>Import as a new note named</Label>
            <Input
              ref={field}
              id={fieldId}
              maxLength={MAX_NOTE_NAME + 10}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${fieldId}-error` : undefined}
            />
            {problem && (
              <p id={`${fieldId}-error`} className="text-sm text-danger">
                {problem}
              </p>
            )}
          </div>
          {prompt.remaining > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox id={allId} checked={all} onCheckedChange={(v) => setAll(v === true)} />
              <Label htmlFor={allId} className="font-normal">
                Apply to all {prompt.remaining + 1} conflicts in this import
              </Label>
            </div>
          )}
          <AlertDialogFooter className="flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => onChoose({ action: "skip" }, all)}>
              Skip
            </Button>
            <Button type="button" variant="destructive" onClick={() => onChoose({ action: "replace" }, all)}>
              Replace…
            </Button>
            <Button type="submit" disabled={!!problem}>
              Import as new note
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The second, explicit confirmation before any existing note's content is replaced (FR-020). */
export function ReplaceConfirmDialog({ names, onAnswer }: { names: string[]; onAnswer: (replace: boolean) => void }) {
  const single = names.length === 1;
  return (
    <AlertDialog open onOpenChange={(open) => !open && onAnswer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{single ? `Replace the content of “${names[0]}”?` : `Replace the content of ${names.length} notes?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {single
              ? "Its current content will be permanently replaced by the imported file. This can't be undone."
              : "The current content of each of these notes will be permanently replaced by its imported file. This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!single && (
          <ul className="grid max-h-48 list-disc gap-1 overflow-y-auto pl-5 text-sm">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={() => onAnswer(true)}>
            {single ? "Replace" : `Replace ${names.length} notes`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
