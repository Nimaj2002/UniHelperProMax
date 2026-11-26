/** 026: first sign-in, Yuii (curious) asks which interface the account wants; skipping keeps Ultimate. */
import { useLocation } from "react-router";
import { useUiMode, type UiMode } from "@/app/uiMode";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import thinking from "./assets/thinking.webp";
import { automated } from "./TourHost";

const NO_ASK = ["/setup", "/login", "/account/password"];
const CHOICES: { value: UiMode; label: string; hint: string }[] = [
  { value: "simple", label: "Simple", hint: "One sidebar and one main area, like a chat app." },
  { value: "ultimate", label: "Ultimate", hint: "The full workspace with side panels." },
];

export function UiChoiceHost() {
  const { chosen, setMode } = useUiMode();
  const { pathname } = useLocation();
  const open = chosen === false && !automated() && !NO_ASK.some((p) => pathname.startsWith(p));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && setMode("ultimate")}>
      <DialogContent className="max-w-md">
        <div className="flex items-center gap-4">
          <img src={thinking} alt="Yuii, curious" className="h-28 w-auto shrink-0" />
          <div>
            <DialogTitle>Which look do you want?</DialogTitle>
            <DialogDescription>I'm curious! You can switch any time in Settings → Appearance.</DialogDescription>
          </div>
        </div>
        <div className="grid gap-2">
          {CHOICES.map((c) => (
            <Button key={c.value} variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => setMode(c.value)}>
              <span className="grid gap-0.5">
                <span className="font-medium">{c.label}</span>
                <span className="text-sm font-normal text-muted-foreground">{c.hint}</span>
              </span>
            </Button>
          ))}
        </div>
        <DialogFooter className="sm:justify-start">
          <Button variant="ghost" size="sm" onClick={() => setMode("ultimate")}>Decide later (Ultimate)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
