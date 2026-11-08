/** 024: the demo notice shown above every screen (FR-011, contracts/demo-mode.md §5). */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DOWNLOAD_URL } from "./unavailable";

/** Forget the app's per-browser caches (theme, tour, layout), so the next load starts fresh. */
export function clearAppCaches(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("uh.")) localStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing cached either */
  }
}

export function resetDemo(): void {
  clearAppCaches();
  window.location.reload();
}

export function DemoBanner() {
  return (
    <div
      role="region"
      aria-label="Demo notice"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-primary px-4 py-1.5 text-sm text-primary-foreground"
    >
      <p className="text-center">You're trying the demo. Changes aren't saved.</p>
      <div className="flex items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="secondary">
              Reset demo
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
              <AlertDialogDescription>Your changes will be lost and the sample workspace comes back.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={resetDemo}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button size="sm" variant="secondary" asChild>
          <a href={DOWNLOAD_URL} target="_blank" rel="noopener">
            Download the app
          </a>
        </Button>
      </div>
    </div>
  );
}
