/**
 * Settings → Version (desktop app): the installed version, check for updates, download and
 * restart to update. UpdateNotifier shows a toast linking here when a new version is found.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { desktop, isDesktop, type UpdateState } from "@/features/desktop/bridge";

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    const off = desktop.onUpdateState(setState);
    void desktop.updates.state().then((s) => live && s && setState(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

export function statusText(s: UpdateState): string {
  switch (s.status) {
    case "unsupported":
      return "Updates are checked only in the installed app.";
    case "idle":
      return "Not checked yet.";
    case "checking":
      return "Checking for updates…";
    case "none":
      return "You have the latest version.";
    case "available":
      return `Version ${s.version} is available.`;
    case "downloading":
      return `Downloading version ${s.version ?? ""}… ${s.percent ?? 0}%`;
    case "ready":
      return `Version ${s.version} is ready to install.`;
    case "error":
      return `Couldn't update: ${s.error ?? "unknown error"}`;
  }
}

export function VersionSettings() {
  const s = useUpdateState();
  return (
    <div className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <h2 className="text-lg font-semibold">Version</h2>
        <p className="text-sm text-muted-foreground">
          {s ? (
            <>
              UniHelperProMax <span className="font-medium text-foreground">{s.current}</span>
            </>
          ) : isDesktop() ? (
            "Loading…"
          ) : (
            "Updates are available in the desktop app."
          )}
        </p>
      </header>
      {s && (
        <section className="grid gap-3" aria-label="Updates">
          <p role="status" className={s.status === "error" ? "text-sm text-danger" : "text-sm"}>
            {statusText(s)}
          </p>
          {s.status === "downloading" && <Progress value={s.percent ?? 0} aria-label="Download progress" />}
          {s.status === "ready" && (
            <p className="text-sm text-muted-foreground">It also installs by itself the next time you quit the app.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {s.status === "ready" ? (
              <Button onClick={() => void desktop.updates.install()}>Restart and update</Button>
            ) : (s.status === "available" || (s.status === "error" && s.version)) ? (
              <Button onClick={() => void desktop.updates.download()}>
                {s.selfInstall ? "Download update" : "Download from GitHub"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={s.status === "unsupported" || s.status === "checking" || s.status === "downloading"}
              onClick={() => void desktop.updates.check()}
            >
              Check for updates
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/** Global host: an in-app toast when a new version is found or ready, linking to Settings → Version. */
export function UpdateNotifier() {
  const s = useUpdateState();
  const navigate = useNavigate();
  const shown = useRef(new Set<string>());
  useEffect(() => {
    if (!s?.version || (s.status !== "available" && s.status !== "ready" && s.status !== "downloading")) return;
    const key = `${s.status === "ready" ? "ready" : "found"}:${s.version}`;
    if (shown.current.has(key)) return;
    shown.current.add(key);
    toast(s.status === "ready" ? `Version ${s.version} is ready to install` : `Version ${s.version} is available`, {
      id: "app-update",
      duration: Infinity,
      closeButton: true,
      action: { label: s.status === "ready" ? "Update" : "View", onClick: () => void navigate("/settings/version") },
    });
  }, [s, navigate]);
  return null;
}
