import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ConflictInfo } from "./autosave";

const COPY: Record<ConflictInfo["kind"], { title: string; text: string; theirs: string }> = {
  version: {
    title: "This note was changed in another window",
    text: "Your text and the other version are both kept until you choose.",
    theirs: "Use the other version",
  },
  changed: {
    title: "This note was changed outside the app",
    text: "The file was edited in another program. Your text and the file's text are both kept until you choose.",
    theirs: "Use the file's version",
  },
  missing: {
    title: "This note's file was deleted outside the app",
    text: "Your text is still here. Save it back to a file, or keep it as a separate note.",
    theirs: "Discard my text",
  },
};

function preview(text: string | null) {
  if (text === null) return "(no file)";
  const t = text.trim();
  return t ? (t.length > 400 ? `${t.slice(0, 400)}…` : t) : "(empty)";
}

interface Props {
  noteName: string;
  conflict: ConflictInfo;
  mine: string;
  onKeepBoth: () => Promise<void>;
  onUseMine: () => Promise<void>;
  onUseTheirs: () => void;
}

/** FR-020: never overwrite silently — the user decides; "Keep both" is the default. */
export function ConflictDialog({ noteName, conflict, mine, onKeepBoth, onUseMine, onUseTheirs }: Props) {
  const [busy, setBusy] = useState(false);
  const keepBoth = useRef<HTMLButtonElement>(null);
  const copy = COPY[conflict.kind];
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          keepBoth.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            “{noteName}” — {copy.text}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <figure className="grid gap-1">
            <figcaption className="text-sm font-medium">Your text</figcaption>
            <pre className="max-h-48 overflow-auto rounded-md border bg-surface-sunken p-2 text-xs whitespace-pre-wrap">{preview(mine)}</pre>
          </figure>
          <figure className="grid gap-1">
            <figcaption className="text-sm font-medium">{conflict.kind === "version" ? "Other version" : "File on disk"}</figcaption>
            <pre className="max-h-48 overflow-auto rounded-md border bg-surface-sunken p-2 text-xs whitespace-pre-wrap">
              {preview(conflict.current.content)}
            </pre>
          </figure>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => run(onUseTheirs)}>{copy.theirs}</Button>
          <Button variant="outline" disabled={busy} onClick={() => run(onUseMine)}>
            {conflict.kind === "missing" ? "Save my text to the file" : "Use mine"}
          </Button>
          <Button ref={keepBoth} disabled={busy} onClick={() => run(onKeepBoth)}>
            Keep both
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
