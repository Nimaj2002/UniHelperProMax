/** Registers account-menu items and hosts the time-zone dialog. */
import { useEffect, useState } from "react";
import { registerAccountMenuItem, registerGlobalHost } from "@/app/shell/registry";
import { TimeZoneDialog } from "./TimeZoneDialog";

let openTimeZone: (() => void) | null = null;

function TimeZoneHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openTimeZone = () => setOpen(true);
    return () => {
      openTimeZone = null;
    };
  }, []);
  return <TimeZoneDialog open={open} onOpenChange={setOpen} />;
}

export function registerAccountMenu() {
  registerAccountMenuItem({ id: "password", label: "Change password", priority: 1, onSelect: (nav) => nav("/account/password") });
  registerAccountMenuItem({ id: "timezone", label: "Time zone…", priority: 2, onSelect: () => openTimeZone?.() });
  registerAccountMenuItem({ id: "admin", label: "Manage accounts", ownerOnly: true, priority: 3, onSelect: (nav) => nav("/admin/accounts") });
  registerGlobalHost({ id: "timezone-dialog", component: TimeZoneHost });
}
