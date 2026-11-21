import { useState, type FormEvent } from "react";
import { Field } from "@/components/form/Field";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { isApiError } from "@/lib/api";
import { formatDuration } from "@/features/recordings/format";
import type { MediaRecording, TrimResult } from "../../api";
import { keptMs, type Range } from "./windows";

export interface SaveChoice {
  mode: "new" | "overwrite";
  name?: string;
  combine: "merge" | "separate";
}

interface Props {
  recording: MediaRecording;
  /** The windows being saved: with two or more, the user also chooses merged or separate. */
  windows: Range[];
  /** Runs the save; resolves with the result or rejects with the API error. */
  onSave: (choice: SaveChoice) => Promise<TrimResult>;
  onClose: () => void;
}

/**
 * The save choice (025 FR-007–FR-009, FR-006c): with several windows, one merged recording or one
 * per window; then overwrite the source (merged only), or keep it and save under a new name.
 */
export function SaveDialog({ recording, windows, onSave, onClose }: Props) {
  const many = windows.length > 1;
  const [combine, setCombine] = useState<"merge" | "separate">("merge");
  const [mode, setMode] = useState<"new" | "overwrite">("new");
  const [name, setName] = useState(`${recording.name} (trimmed)`.slice(0, 120));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const separate = many && combine === "separate";
  const effective = separate ? "new" : mode; // overwriting needs one merged result

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (effective === "new" && !name.trim()) return setError("Enter a name.");
    setBusy(true);
    setError(undefined);
    try {
      await onSave({ mode: effective, name: effective === "new" ? name.trim() : undefined, combine });
    } catch (err) {
      setError(isApiError(err) ? (err.fieldMessage("/name") ?? err.title) : "Couldn't save. Please retry.");
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save trimmed audio</AlertDialogTitle>
          <AlertDialogDescription>
            Keeps {formatDuration(keptMs(windows))} of “{recording.name}”{many ? ` in ${windows.length} windows` : ""}. Choose what happens
            next.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          {many && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">The {windows.length} windows</legend>
              <RadioGroup value={combine} onValueChange={(v) => setCombine(v as "merge" | "separate")} aria-label="How to save the windows">
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="merge" id="combine-merge" className="mt-1" />
                  <Label htmlFor="combine-merge" className="grid gap-0.5 font-normal">
                    <span className="font-medium">Merge into one recording</span>
                    <span className="text-sm text-muted-foreground">The windows are joined in order.</span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="separate" id="combine-separate" className="mt-1" />
                  <Label htmlFor="combine-separate" className="grid gap-0.5 font-normal">
                    <span className="font-medium">Save each window as its own recording</span>
                    <span className="text-sm text-muted-foreground">{windows.length} new recordings, numbered in order.</span>
                  </Label>
                </div>
              </RadioGroup>
            </fieldset>
          )}
          <fieldset className="grid gap-2">
            {many && <legend className="mb-1 text-sm font-medium">Where to save</legend>}
            <RadioGroup value={effective} onValueChange={(v) => setMode(v as "new" | "overwrite")} aria-label="Where to save">
              <div className="flex items-start gap-2">
                <RadioGroupItem value="new" id="save-new" className="mt-1" />
                <Label htmlFor="save-new" className="grid gap-0.5 font-normal">
                  <span className="font-medium">Save as a new {separate ? "recordings" : "recording"}</span>
                  <span className="text-sm text-muted-foreground">The original stays exactly as it is.</span>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="overwrite" id="save-overwrite" disabled={separate} className="mt-1" />
                <Label htmlFor="save-overwrite" className={`grid gap-0.5 font-normal ${separate ? "opacity-60" : ""}`}>
                  <span className="font-medium">Overwrite the original</span>
                  <span className="text-sm text-muted-foreground">
                    {separate
                      ? "Only available when the windows are merged into one recording."
                      : "The trimmed audio replaces it. The old audio goes to Settings → Trash, where you can restore it."}
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </fieldset>
          {effective === "new" && (
            <Field label={separate ? "Base name" : "Name"} error={error}>
              <Input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          {separate && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Saved as “{name.trim() || "Name"} 1”, “{name.trim() || "Name"} 2”…
            </p>
          )}
          {effective === "overwrite" && (
            <div className="grid gap-2 text-sm" role="note">
              <p className="font-medium text-warning">The original audio will be replaced.</p>
              <p className="text-muted-foreground">A copy of the old audio is kept in Settings → Trash.</p>
              {recording.hasTranscript && (
                <p className="text-muted-foreground">
                  This recording has a transcript. It is kept, but its timing will no longer match the trimmed audio.
                </p>
              )}
              {error && (
                <p role="alert" className="text-danger">
                  {error}
                </p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="submit" variant={effective === "overwrite" ? "destructive" : "default"} disabled={busy}>
              {busy ? "Saving…" : effective === "overwrite" ? "Overwrite original" : separate ? `Save ${windows.length} recordings` : "Save new recording"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
