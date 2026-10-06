/** Feature 005 wiring: Settings routes, entry points on every screen, theme sync. */
import { GearSix } from "@phosphor-icons/react";
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, useNavigate, type RouteObject } from "react-router";
import { registerAccountMenuItem, registerGlobalHost, registerTopBarAction } from "@/app/shell/registry";
import { Button } from "@/components/ui/button";
import { SettingsLayout } from "./SettingsLayout";
import { ThemeSync } from "./ThemeSync";
import { TranscriptionSettingsPage } from "./transcription/TranscriptionSettings";

// the theme editor and its colour maths load only when Appearance is opened
const AppearanceSettings = lazy(() => import("./themes/AppearanceSettings").then((m) => ({ default: m.AppearanceSettings })));
const ThemeEditor = lazy(() => import("./themes/ThemeEditor").then((m) => ({ default: m.ThemeEditor })));

const loading = (node: ReactNode) => <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading…</p>}>{node}</Suspense>;

function SettingsButton() {
  const navigate = useNavigate();
  return (
    <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => navigate("/settings")}>
      <GearSix size={18} />
    </Button>
  );
}

registerTopBarAction({ id: "settings", component: SettingsButton, priority: 10 });
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
    ],
  },
];
