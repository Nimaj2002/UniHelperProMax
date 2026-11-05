/** 021 US1: Settings → Proxy — save, test and delete the one proxy used by Transcription and AI. */
import { CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isApiError } from "@/lib/api";
import { KeyField, initialKeyDraft, keyPayload, type KeyDraft } from "../KeyField";
import {
  proxyKey, useDeleteProxy, useProxy, useSaveProxy, useTestProxy,
  type Proxy, type ProxyScheme, type ProxySection, type ProxyTestResult,
} from "./api";

const SCHEMES: { value: ProxyScheme; label: string }[] = [
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "socks5", label: "SOCKS5" },
];
const SECTION_NAMES: Record<ProxySection, string> = { transcription: "Transcription", ai: "AI" };
const PASTED_SCHEMES: Record<string, ProxyScheme> = { http: "http", https: "https", socks5: "socks5", socks5h: "socks5" };

/** A whole proxy address pasted into Host, e.g. "socks5://user:pass@127.0.0.1:1080", split into fields. */
export function parseProxyAddress(text: string) {
  const m = /^\s*([a-z0-9]+):\/\/([^/\s]+)\/?\s*$/i.exec(text);
  const scheme = m && PASTED_SCHEMES[m[1].toLowerCase()];
  if (!m || !scheme) return null;
  try {
    // Parsed as http: so every browser fills host, port and credentials; http drops port 80, so read it back.
    const url = new URL(`http://${m[2]}`);
    return {
      scheme,
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port || (/:(\d+)$/.exec(m[2])?.[1] ?? ""),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}
const sections = (list: ProxySection[]) => list.map((s) => SECTION_NAMES[s]).join(" and ");

export function ProxySettingsPage() {
  const proxy = useProxy();
  if (proxy.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  if (!proxy.data) return <p role="alert" className="text-sm text-danger">Couldn't load the settings. Reload to try again.</p>;
  // remount the form when the saved proxy changes (save, delete) so the fields show what is saved
  const saved = proxy.data.proxy;
  return <ProxyForm key={saved ? `${saved.version}` : "none"} saved={saved} usedBy={proxy.data.usedBy} />;
}

function ProxyForm({ saved, usedBy }: { saved: Proxy | null; usedBy: ProxySection[] }) {
  const qc = useQueryClient();
  const save = useSaveProxy();
  const test = useTestProxy();
  const remove = useDeleteProxy();
  const [scheme, setScheme] = useState<ProxyScheme>(saved?.scheme ?? "http");
  const [host, setHost] = useState(saved?.host ?? "");
  const [port, setPort] = useState(saved ? String(saved.port) : "");
  const [username, setUsername] = useState(saved?.username ?? "");
  const savedPassword = saved
    ? { ...saved.password, masked: `••••••••${saved.password.last4 ?? ""}` }
    : undefined;
  const [password, setPassword] = useState<KeyDraft>(() => initialKeyDraft(savedPassword));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ProxyTestResult | null>(null);

  const edited = () => {
    setResult(null);
    setErrors({});
  };

  /** Fills the fields from a whole address like "socks5://127.0.0.1:10808"; false if it isn't one. */
  const splitAddress = (text: string) => {
    const pasted = parseProxyAddress(text);
    if (!pasted) return false;
    edited();
    setScheme(pasted.scheme);
    setHost(pasted.host);
    if (pasted.port) setPort(pasted.port);
    if (pasted.username) setUsername(pasted.username);
    if (pasted.password) setPassword({ mode: "replace", value: pasted.password });
    return true;
  };

  /** Checks the browser can do; the server validates again. */
  const validate = (): { host: string; port: number } | null => {
    const out: Record<string, string> = {};
    const portNumber = Number(port);
    if (!host.trim()) out.host = "Enter the proxy's host name or IP address.";
    else if (/[\s/@]|:\/\//.test(host.trim())) out.host = "Enter only the host name or IP address, such as proxy.example.com.";
    if (!/^\d+$/.test(port.trim()) || portNumber < 1 || portNumber > 65535) out.port = "Enter a port from 1 to 65535.";
    setErrors(out);
    return Object.keys(out).length ? null : { host: host.trim(), port: portNumber };
  };

  const serverErrors = (err: unknown) => {
    if (!isApiError(err)) return setErrors({ form: "Couldn't reach the server. Try again." });
    const out: Record<string, string> = {};
    for (const e of err.errors) {
      const field = e.field.split("/").pop() ?? "";
      out[["host", "port", "username", "password"].includes(field) ? field : "form"] = e.message;
    }
    if (!err.errors.length) out.form = err.detail ?? err.title;
    setErrors(out);
  };

  const passwordPayload = (): { password?: string | null } => {
    const p = keyPayload(password);
    return "apiKey" in p ? { password: p.apiKey } : {};
  };

  const runTest = () => {
    const checked = validate();
    if (!checked) return;
    setResult(null);
    const p = passwordPayload();
    test.mutate(
      {
        scheme, ...checked, username: username.trim() || null,
        password: p.password ?? null,
        useSavedPassword: password.mode === "saved",
      },
      { onSuccess: setResult, onError: serverErrors },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const checked = validate();
    if (!checked) return;
    save.mutate(
      { version: saved?.version, body: { scheme, ...checked, username: username.trim() || null, ...passwordPayload() } },
      {
        onSuccess: () => toast.success("Proxy saved."),
        onError: (err) => {
          if (isApiError(err, "version_conflict")) {
            toast.error("The proxy was changed elsewhere. It was reloaded.");
            void qc.invalidateQueries({ queryKey: proxyKey });
          } else serverErrors(err);
        },
      },
    );
  };

  const del = () => {
    if (!saved) return;
    remove.mutate(saved.version, {
      onSuccess: ({ disabledSections }) =>
        toast.success(disabledSections.length ? `Proxy deleted. Turned it off for ${sections(disabledSections)}.` : "Proxy deleted."),
      onError: (err) => toast.error(isApiError(err) ? (err.detail ?? err.title) : "Couldn't reach the server. Try again."),
    });
  };

  const fieldError = (name: string) =>
    errors[name] ? { "aria-invalid": true as const, "aria-describedby": `proxy-${name}-error` } : {};

  return (
    <form onSubmit={submit} noValidate className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <h2 className="text-lg font-semibold">Proxy</h2>
        <p className="text-sm text-muted-foreground">
          Send transcription and AI requests through a proxy, for example when your network blocks a provider. Turn it on
          separately in Settings → Transcription and Settings → AI. Addresses on this computer or your local network always
          connect directly.
        </p>
        {usedBy.length > 0 && <p className="text-sm">In use by {sections(usedBy)}.</p>}
      </header>

      <div className="grid gap-4">
        <div className="grid max-w-xs gap-2">
          <Label htmlFor="proxy-scheme">Type</Label>
          <Select value={scheme} onValueChange={(v) => { edited(); setScheme(v as ProxyScheme); }}>
            <SelectTrigger id="proxy-scheme" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEMES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {scheme === "http" && (
            <p className="text-sm text-muted-foreground">An HTTP proxy receives the username and password unencrypted.</p>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <div className="grid min-w-0 flex-1 basis-56 gap-2">
            <Label htmlFor="proxy-host">Host</Label>
            <Input id="proxy-host" value={host} placeholder="proxy.example.com" autoComplete="off" spellCheck={false}
              onChange={(e) => { edited(); setHost(e.target.value); }}
              onBlur={(e) => splitAddress(e.target.value)}
              onPaste={(e) => { if (splitAddress(e.clipboardData.getData("text"))) e.preventDefault(); }}
              {...fieldError("host")} />
            {errors.host && <p id="proxy-host-error" className="text-sm text-danger">{errors.host}</p>}
          </div>
          <div className="grid w-28 gap-2">
            <Label htmlFor="proxy-port">Port</Label>
            <Input id="proxy-port" value={port} inputMode="numeric" placeholder="8080" autoComplete="off"
              onChange={(e) => { edited(); setPort(e.target.value); }} {...fieldError("port")} />
            {errors.port && <p id="proxy-port-error" className="text-sm text-danger">{errors.port}</p>}
          </div>
        </div>

        <div className="grid max-w-sm gap-2">
          <Label htmlFor="proxy-username">
            Username <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="proxy-username" value={username} autoComplete="off" spellCheck={false}
            onChange={(e) => { edited(); setUsername(e.target.value); }} {...fieldError("username")} />
          {errors.username && <p id="proxy-username-error" className="text-sm text-danger">{errors.username}</p>}
        </div>

        <KeyField
          id="proxy-password"
          label={<>Password <span className="font-normal text-muted-foreground">(optional)</span></>}
          saved={savedPassword}
          maskedLabel={`Saved password ending in ${saved?.password.last4 ?? "…"}`}
          draft={password}
          onChange={(next) => { edited(); setPassword(next); }}
          error={errors.password}
          errorId="proxy-password-error"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={runTest} disabled={test.isPending}>
          {test.isPending && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
          {test.isPending ? "Testing…" : "Test proxy"}
        </Button>
        <p role="status" className="text-sm">
          {result?.outcome === "working" && (
            <span className="flex items-center gap-1.5 text-success"><CheckCircle size={16} aria-hidden /> {result.message}</span>
          )}
          {result && result.outcome !== "working" && (
            <span className="flex items-center gap-1.5 text-danger"><WarningCircle size={16} aria-hidden /> {result.message}</span>
          )}
        </p>
      </div>

      {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        {saved && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" disabled={remove.isPending}>Delete proxy</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete the proxy?</AlertDialogTitle>
                <AlertDialogDescription>
                  {usedBy.length
                    ? `${sections(usedBy)} will connect directly again.`
                    : "Nothing uses it right now."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button type="button" variant="destructive" onClick={del} disabled={remove.isPending}>Delete</Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </form>
  );
}
