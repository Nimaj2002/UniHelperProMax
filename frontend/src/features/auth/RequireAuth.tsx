import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { SplashScreen } from "@/components/SplashScreen";
import { useMe, useSetupStatus } from "./api";

function FullPageStatus({ label }: { label: string }) {
  return (
    <div role="status" className="grid min-h-[100dvh] place-items-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

/** Guards: no owner yet → /setup; signed out → /login; must change password → /account/password.
 * The desktop app (015) has one implicit owner and no sign-in: nothing to guard. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSetupStatus();
  const me = useMe();
  const location = useLocation();

  if (status.isPending || me.isPending) return <SplashScreen />;
  if (status.isError || me.isError) return <FullPageStatus label="Can't reach the server. Reload to retry." />;
  if (status.data.mode === "desktop") return <>{children}</>;
  if (status.data.needsOwner) return <Navigate to="/setup" replace />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (me.data.mustChangePassword && location.pathname !== "/account/password")
    return <Navigate to="/account/password" replace />;
  return <>{children}</>;
}
