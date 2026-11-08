import { SignOut } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { signOutAllowed } from "@/app/shell/registry";
import { Button } from "@/components/ui/button";
import { useIsDesktop, useLogout, useMe } from "@/features/auth/api";
import { TimeZoneDialog } from "@/features/auth/TimeZoneDialog";
import { startTour } from "@/features/tour/store";

function Row({ title, detail, children }: { title: string; detail?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {detail && <span className="truncate text-sm text-muted-foreground">{detail}</span>}
      </div>
      {children}
    </div>
  );
}

/** Settings → Account: the account-menu actions, in one place. */
export function AccountSettings() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const [tzOpen, setTzOpen] = useState(false);
  const desktop = useIsDesktop(); // 015: no password, accounts or sign-out in the desktop app

  const signOut = () => {
    const proceed = () => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) });
    if (signOutAllowed(proceed)) proceed();
  };

  return (
    <div className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <h2 className="text-lg font-semibold">Account</h2>
        {!desktop && (
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{me?.username}</span>
          </p>
        )}
      </header>

      <div className="divide-y divide-border">
        {!desktop && (
          <Row title="Password">
            <Button variant="outline" size="sm" onClick={() => navigate("/account/password")}>Change password</Button>
          </Row>
        )}
        <Row title="Time zone" detail={me?.timezone.replaceAll("_", " ")}>
          <Button variant="outline" size="sm" onClick={() => setTzOpen(true)}>Change…</Button>
        </Row>
        <Row title="Tour" detail="Yuii shows you around the app again">
          <Button variant="outline" size="sm" onClick={() => startTour()}>Replay tour with Yuii</Button>
        </Row>
        {!desktop && me?.role === "owner" && (
          <Row title="Accounts" detail="Create, disable and reset accounts">
            <Button variant="outline" size="sm" onClick={() => navigate("/admin/accounts")}>Manage accounts</Button>
          </Row>
        )}
      </div>

      {!desktop && (
        <div>
          <Button variant="outline" onClick={signOut} disabled={logout.isPending}>
            <SignOut size={16} /> Sign out
          </Button>
        </div>
      )}

      <TimeZoneDialog open={tzOpen} onOpenChange={setTzOpen} />
    </div>
  );
}
