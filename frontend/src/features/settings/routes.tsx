/** Feature 005 wiring: Settings routes, entry points on every screen, theme sync. */
import { GearSix } from "@phosphor-icons/react";
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, useNavigate, type RouteObject } from "react-router";
import { registerAccountMenuItem, registerGlobalHost, registerPanelAction, type PanelActionProps } from "@/app/shell/registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountSettings } from "./account/AccountSettings";
import { SettingsLayout } from "./SettingsLayout";
import { ThemeSync } from "./ThemeSync";
import { TranscriptionSettingsPage } from "./transcription/TranscriptionSettings";

// the theme editor and its colour maths load only when Appearance is opened
const AppearanceSettings = lazy(() => import("./themes/AppearanceSettings").then((m) => ({ default: m.AppearanceSettings })));
const ThemeEditor = lazy(() => import("./themes/ThemeEditor").then((m) => ({ default: m.ThemeEditor })));
// 009 US4: Settings → Trash
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

export const routes: RouteObject[] = [
  {
    path: "settings",
    element: <SettingsLayout />,
    children: [
      { index: true, element: <Navigate to="/settings/transcription" replace /> },
      { path: "transcription", element: <TranscriptionSettingsPage /> },
      { path: "appearance", element: loading(<AppearanceSettings />) },
      { path: "appearance/themes/new", element: loading(<ThemeEditor />) },
      { path: "appearance/themes/:themeId", element: loading(<ThemeEditor />) },
      { path: "trash", element: loading(<TrashPage />) },
      { path: "account", element: <AccountSettings /> },
    ],
  },
];
