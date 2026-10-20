import { NavLink, Outlet } from "react-router";
import { useCreditStrip } from "@/app/shell/layout";
import { PageFrame } from "@/app/shell/PageFrame";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { to: "/settings/transcription", label: "Transcription" },
  { to: "/settings/ai", label: "AI" },
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/shortcuts", label: "Keyboard shortcuts" },
  { to: "/settings/import-export", label: "Import and export" },
  { to: "/settings/trash", label: "Trash" },
  { to: "/settings/account", label: "Account" },
];

/** Settings area (005 FR-001): section nav + content. */
export function SettingsLayout() {
  useCreditStrip();
  return (
    <PageFrame>
      <div className="mx-auto grid max-w-5xl gap-6 px-4 pt-2 pb-6 sm:px-6 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <nav aria-label="Settings sections" className="flex gap-1 md:flex-col">
            {SECTIONS.map((s) => (
              <NavLink
                key={s.to}
                to={s.to}
                className={({ isActive }) =>
                  cn("rounded-md px-3 py-1.5 text-sm hover:bg-accent", isActive ? "bg-accent font-medium text-foreground" : "text-muted-foreground")
                }
              >
                {s.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </PageFrame>
  );
}
