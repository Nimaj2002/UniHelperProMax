import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Recording } from "@/features/recordings/api";
import { notesKey, useNotes } from "@/features/sessions/api";
import { formatDay } from "@/lib/dates";
import { isApiError } from "@/lib/api";
import { activeKey, historyKey, SETTINGS_PATH, startTranscription, useSessionTranscriptions, useTranscriptionStatus } from "./api";
import { languageOptions } from "./languages";

const NEW = "__new__";

function suggestName(taken: string[]): string {
  const keys = new Set(taken.map((n) => n.toLocaleLowerCase()));
  if (!keys.has("transcript")) return "Transcript";
  for (let i = 2; ; i++) if (!keys.has(`transcript (${i})`)) return `Transcript (${i})`;
}

/** Choose the note (or a new one) and the language, then start (FR-002–FR-005, US2, US5 #2). */
export function TranscribeDialog({ recording, sessionKey, onClose }: { recording: Recording; sessionKey: string; onClose: () => void }) {
  const qc = useQueryClient();
  const status = useTranscriptionStatus();
  const notes = useNotes(sessionKey);
  const history = useSessionTranscriptions(sessionKey);
  const list = useMemo(() => notes.data ?? [], [notes.data]);
  const [target, setTarget] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const chosen = target ?? (list[0]?.id ?? NEW);
  const newName = name ?? suggestName(list.map((n) => n.name));
  const lang = language ?? status.data?.defaultLanguage ?? "auto";
  const previous = (history.data ?? []).find((j) => j.recordingId === recording.id && j.status === "completed" && j.noteId === chosen);
  const loading = status.isPending || notes.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (chosen === NEW && !newName.trim()) return setError("Enter a name for the new note.");
    setBusy(true);
    setError(undefined);
    try {
      const job = await startTranscription(recording.id, {
        ...(chosen === NEW ? { newNoteName: newName.trim() } : { noteId: chosen }),
        language: lang,
      });
      qc.setQueryData(activeKey, job); // all Transcribe buttons disable at once; polling starts
      void qc.invalidateQueries({ queryKey: notesKey(sessionKey) });
      void qc.invalidateQueries({ queryKey: historyKey(sessionKey) });
      onClose();
    } catch (err) {
      if (isApiError(err, "provider_not_configured")) void qc.invalidateQueries({ queryKey: ["transcription", "status"] });
      setError(isApiError(err) ? (err.fieldMessage("/name") ?? err.title) : "Couldn't start the transcription. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transcribe “{recording.name}”</DialogTitle>
          <DialogDescription>
            {status.data?.configured
              ? `The transcript is added at the end of the note. Using ${status.data.providerName}.`
              : "The transcript is added at the end of a note of this session."}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !status.data?.configured ? (
          <div className="grid gap-4">
            <p className="text-sm">Set up a transcription provider first.</p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button asChild>
                <Link to={SETTINGS_PATH}>Open Settings → Transcription</Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4">
            {list.length > 0 && (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Add the transcript to</legend>
                <RadioGroup value={chosen} onValueChange={setTarget} className="grid gap-1.5" aria-label="Add the transcript to">
                  {list.map((n) => (
                    <div key={n.id} className="flex items-center gap-2">
                      <RadioGroupItem value={n.id} id={`target-${n.id}`} />
                      <Label htmlFor={`target-${n.id}`} className="min-w-0 truncate font-normal" title={n.name}>{n.name}</Label>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value={NEW} id="target-new" />
                    <Label htmlFor="target-new" className="font-normal">New note…</Label>
                  </div>
                </RadioGroup>
              </fieldset>
            )}
            {chosen === NEW && (
              <div className="grid gap-2">
                <Label htmlFor="transcript-note-name">Note name</Label>
                <Input
                  id="transcript-note-name"
                  maxLength={120}
                  value={newName}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="transcript-language">Spoken language</Label>
              <Select value={lang} onValueChange={setLanguage}>
                <SelectTrigger id="transcript-language" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions(lang).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {previous && (
              <Alert>
                <AlertDescription>
                  This recording was already transcribed into “{previous.noteName}”
                  {previous.finishedAt ? ` on ${formatDay(previous.finishedAt.slice(0, 10), "d MMM")}` : ""}. Transcribe again?
                </AlertDescription>
              </Alert>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Starting…" : previous ? "Transcribe again" : "Transcribe"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
