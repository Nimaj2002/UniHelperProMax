/** Feature 005 wiring: Settings routes, entry points on every screen, theme sync. */
import { GearSix } from "@phosphor-icons/react";
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, useNavigate, type RouteObject } from "react-router";
import { registerAccountMenuItem, registerGlobalHost, registerPanelAction, type PanelActionProps } from "@/app/shell/registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountSettings } from "./account/AccountSettings";
import { RestoreHost } from "./backup/RestoreOverlay";
import { SettingsLayout } from "./SettingsLayout";
import { KeymapSync } from "@/lib/keymap";
import { ThemeSync } from "./ThemeSync";
import { TranscriptionSettingsPage } from "./transcription/TranscriptionSettings";

// the theme editor and its colour maths load only when Appearance is opened
const AppearanceSettings = lazy(() => import("./themes/AppearanceSettings").then((m) => ({ default: m.AppearanceSettings })));
const ThemeEditor = lazy(() => import("./themes/ThemeEditor").then((m) => ({ default: m.ThemeEditor })));
// 010: Settings → Import and export
const ImportExportPage = lazy(() => import("./calendar-io/ImportExportPage").then((m) => ({ default: m.ImportExportPage })));
// 014 US1: Settings → AI
const AiSettingsPage = lazy(() => import("./ai/AiSettings").then((m) => ({ default: m.AiSettingsPage })));
// 021: Settings → Proxy
const ProxySettingsPage = lazy(() => import("./proxy/ProxySettings").then((m) => ({ default: m.ProxySettingsPage })));
// Settings → Keyboard shortcuts
const ShortcutsSettings = lazy(() => import("./shortcuts/ShortcutsSettings").then((m) => ({ default: m.ShortcutsSettings })));
// 016: Settings → Backup & restore
const BackupPage = lazy(() => import("./backup/BackupPage").then((m) => ({ default: m.BackupPage })));
// 009 US4: Settings → Trash
const TimeSettings = lazy(() => import("./time/TimeSettings").then((m) => ({ default: m.TimeSettings })));
const TrashPage = lazy(() => import("./trash/TrashPage").then((m) => ({ default: m.TrashPage })));

const loading = (node: ReactNode) => <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading…</p>}>{node}</Suspense>;

function SettingsButton({ variant = "full" }: PanelActionProps) {
  const navigate = useNavigate();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Settings" onClick={() => navigate("/settings")}>
          <GearSix size={18} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={variant === "icon" ? "right" : "top"}>Settings</TooltipContent>
    </Tooltip>
  );
}

registerPanelAction({ id: "settings", slot: "footer", component: SettingsButton, priority: 10 });
registerAccountMenuItem({ id: "settings", label: "Settings", priority: 0, onSelect: (nav) => nav("/settings") });
registerGlobalHost({ id: "theme-sync", component: ThemeSync });
registerGlobalHost({ id: "keymap-sync", component: KeymapSync }); // 019: custom shortcuts
registerGlobalHost({ id: "restore-host", component: RestoreHost }); // 016: restore overlay, reload

export const routes: RouteObject[] = [
  {
    path: "settings",
    element: <SettingsLayout />,
    children: [
      { index: true, element: <Navigate to="/settings/transcription" replace /> },
      { path: "transcription", element: <TranscriptionSettingsPage /> },
      { path: "ai", element: loading(<AiSettingsPage />) },
      { path: "proxy", element: loading(<ProxySettingsPage />) },
      { path: "appearance", element: loading(<AppearanceSettings />) },
      { path: "appearance/themes/new", element: loading(<ThemeEditor />) },
      { path: "appearance/themes/:themeId", element: loading(<ThemeEditor />) },
      { path: "time", element: loading(<TimeSettings />) },
      { path: "shortcuts", element: loading(<ShortcutsSettings />) },
      { path: "import-export", element: loading(<ImportExportPage />) },
      { path: "backup", element: loading(<BackupPage />) },
      { path: "trash", element: loading(<TrashPage />) },
      { path: "account", element: <AccountSettings /> },
    ],
  },
];
