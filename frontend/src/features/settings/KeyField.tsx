/** The masked API-key control shared by Settings → Transcription and Settings → AI (FR-019):
 *  the saved key is shown masked with Replace and Remove; Remove can be undone until Save. */
import { WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type KeyDraft = { mode: "saved" | "replace" | "remove"; value: string };

export interface SavedKey {
  configured: boolean;
  /** What to show for the saved key, e.g. "••••••••abcd". */
  masked?: string | null;
  /** False when the key store can't decrypt it any more. */
  readable?: boolean;
}

/** The starting draft for a saved key: keep it when it can be read, otherwise ask for a new one. */
export const initialKeyDraft = (saved: SavedKey | undefined): KeyDraft => ({
  mode: saved?.configured && saved.readable !== false ? "saved" : "replace",
  value: "",
});

/** The request field for a draft: absent = keep, a string = replace, null = remove. */
export function keyPayload(draft: KeyDraft): { apiKey?: string | null } {
  if (draft.mode === "remove") return { apiKey: null };
  if (draft.mode === "replace" && draft.value.trim()) return { apiKey: draft.value.trim() };
  return {};
}

interface KeyFieldProps {
  id: string;
  label: ReactNode;
  saved: SavedKey | undefined;
  /** Accessible name of the masked key. */
  maskedLabel: string;
  draft: KeyDraft;
  onChange: (next: KeyDraft) => void;
  error?: string;
  errorId?: string;
}

export function KeyField({ id, label, saved, maskedLabel, draft, onChange, error, errorId = `${id}-error` }: KeyFieldProps) {
  const configured = !!saved?.configured;
  const unreadable = configured && saved?.readable === false;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {draft.mode === "saved" && configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md border border-divider bg-surface-sunken px-2 py-1.5 font-mono text-sm" aria-label={maskedLabel}>
            {saved?.masked ?? ""}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ mode: "replace", value: "" })}>Replace</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ mode: "remove", value: "" })}>Remove</Button>
        </div>
      ) : draft.mode === "remove" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>The saved key will be removed when you save.</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(initialKeyDraft(saved))}>Undo</Button>
        </div>
      ) : (
        <>
          {unreadable && <p className="flex items-center gap-1.5 text-sm"><WarningCircle size={16} className="shrink-0 text-warning" aria-hidden />Key can't be read — enter it again</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              className="max-w-sm"
              value={draft.value}
              onChange={(e) => onChange({ mode: "replace", value: e.target.value })}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            {configured && !unreadable && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ mode: "saved", value: "" })}>Keep saved key</Button>
            )}
            {unreadable && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ mode: "remove", value: "" })}>Remove</Button>
            )}
          </div>
        </>
      )}
      {error && <p id={errorId} className="text-sm text-danger">{error}</p>}
    </div>
  );
}
