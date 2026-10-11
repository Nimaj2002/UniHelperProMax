import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Scope } from "./api";

type Noun = "class" | "event";

function options(noun: Noun): { value: Scope; label: string; hint: string }[] {
  if (noun === "event")
    return [
      { value: "this", label: "This event", hint: "Only this date changes." },
      { value: "following", label: "This and following events", hint: "Earlier events stay as they are." },
      { value: "all", label: "All events", hint: "Events with notes, recordings or documents, or changed individually, keep their values." },
    ];
  return [
    { value: "this", label: "This session", hint: "Only this date changes." },
    { value: "following", label: "This and following sessions", hint: "Earlier sessions stay as they are." },
    { value: "all", label: "All sessions", hint: "Sessions you changed individually keep their changes." },
  ];
}

interface Props {
  action: "edit" | "delete";
  onChoose: (scope: Scope) => void;
  onCancel: () => void;
  /** 009: "event" words the choices for a repeating event (FR-019). */
  noun?: Noun;
}

/** "This session" / "This and following" / "All sessions" (FR-018a); for events "This event" /
 * "This and following events" / "All events" (009 FR-019). */
export function ScopeDialog({ action, onChoose, onCancel, noun = "class" }: Props) {
  const [scope, setScope] = useState<Scope>("this");
  const verb = action === "edit" ? "Edit" : "Delete";
  const OPTIONS = options(noun);
  const many = noun === "event" ? "events" : "sessions";
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{verb} recurring {noun}</DialogTitle>
          <DialogDescription>Which {many} should this {action === "edit" ? "change" : "delete"}?</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onChoose(scope);
          }}
          className="grid gap-5"
        >
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} aria-label={noun === "event" ? "Events affected" : "Sessions affected"} className="grid gap-3">
            {OPTIONS.map((o) => (
              <div key={o.value} className="flex items-start gap-3">
                <RadioGroupItem id={`scope-${o.value}`} value={o.value} aria-describedby={`scope-${o.value}-hint`} className="mt-0.5" />
                <div className="grid gap-0.5">
                  <Label htmlFor={`scope-${o.value}`}>{o.label}</Label>
                  <p id={`scope-${o.value}-hint`} className="text-sm text-muted-foreground">{o.hint}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant={action === "delete" ? "destructive" : "default"}>Continue</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
