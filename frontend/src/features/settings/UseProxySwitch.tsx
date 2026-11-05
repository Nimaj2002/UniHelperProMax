/** 021: the "Use proxy" switch shown in Settings → Transcription and Settings → AI. Off and disabled,
 *  with a link to Settings → Proxy, until a proxy is saved (FR-009). */
import { Link } from "react-router";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProxy } from "./proxy/api";

interface Props {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** What goes through the proxy, e.g. "transcription requests". */
  what: string;
  busy?: boolean;
}

export function UseProxySwitch({ id, checked, onCheckedChange, what, busy }: Props) {
  const proxy = useProxy();
  const configured = !!proxy.data?.proxy;
  const helpId = `${id}-help`;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-3">
        <Switch
          id={id}
          checked={configured && checked}
          disabled={!configured || busy}
          onCheckedChange={onCheckedChange}
          aria-describedby={helpId}
        />
        <Label htmlFor={id}>Use proxy</Label>
      </div>
      <p id={helpId} className="text-sm text-muted-foreground">
        {proxy.isPending ? (
          "Checking for a saved proxy…"
        ) : configured ? (
          <>Send {what} through your proxy. Addresses on this computer or your local network always connect directly.</>
        ) : (
          <>
            No proxy is saved.{" "}
            <Link to="/settings/proxy" className="font-medium text-primary underline underline-offset-2">
              Add a proxy first
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}
