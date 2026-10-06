import { CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { languageOptions } from "@/features/transcription/languages";
import { ApiError } from "@/lib/api";
import {
  saveTranscriptionSettings, testConnection, transcriptionSettingsKey, useProviders, useTranscriptionSettings,
  type ConnectionTestResult, type ProviderSettings, type ProviderSpec, type TranscriptionSettings,
} from "../api";

type KeyState = { mode: "saved" | "replace" | "remove"; value: string };
const STATUS_TEXT: Record<ProviderSettings["status"], string> = {
  not_configured: "Not configured",
  not_tested: "Not tested",
  connected: "Connected",
  failed: "Last test failed",
};

function time(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

export function TranscriptionSettingsPage() {
  const providers = useProviders();
  const settings = useTranscriptionSettings();
  if (providers.isPending || settings.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  if (!providers.data || !settings.data) return <p role="alert" className="text-sm text-danger">Couldn't load the settings. Reload to try again.</p>;
  return <TranscriptionForm specs={providers.data} saved={settings.data} />;
}

function TranscriptionForm({ specs, saved }: { specs: ProviderSpec[]; saved: TranscriptionSettings }) {
  const qc = useQueryClient();
  const savedOf = (id: string) => saved.providers.find((p) => p.providerId === id);
  const [providerId, setProviderId] = useState(saved.activeProviderId ?? specs[0]?.id ?? "voice-studio");
  const [values, setValues] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(specs.map((s) => [s.id, { ...(savedOf(s.id)?.values ?? {}) }])),
  );
  const [keys, setKeys] = useState<Record<string, KeyState>>(() =>
    Object.fromEntries(specs.map((s) => [s.id, { mode: savedOf(s.id)?.secret.configured ? "saved" : "replace", value: "" }])),
  );
  const [language, setLanguage] = useState(saved.defaultLanguage);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const spec = specs.find((s) => s.id === providerId) ?? specs[0];
  const current = savedOf(spec.id);
  const vals = values[spec.id] ?? {};
  const key = keys[spec.id];

  const edited = () => {
    setResult(null); // a change invalidates the last test (spec edge case)
    setErrors({});
  };
  const setValue = (k: string, v: string) => {
    edited();
    setValues((all) => ({ ...all, [spec.id]: { ...all[spec.id], [k]: v } }));
  };
  const setKey = (next: KeyState) => {
    edited();
    setKeys((all) => ({ ...all, [spec.id]: next }));
  };

  const fieldErrors = (err: unknown) => {
    if (!(err instanceof ApiError)) return { form: "Couldn't reach the server. Try again." };
    const known = new Set([...spec.fields.map((f) => (f.kind === "secret" ? "apiKey" : f.key))]);
    const out: Record<string, string> = {};
    for (const e of err.errors) {
      const field = e.field.split("/").pop() ?? "";
      out[known.has(field) ? field : "form"] = e.message;
    }
    if (!err.errors.length) out.form = err.title;
    return out;
  };

  const apiKeyField = spec.fields.find((f) => f.kind === "secret");
  const keyPayload = (): { apiKey?: string | null } => {
    if (!apiKeyField) return {};
    if (key.mode === "remove") return { apiKey: null };
    if (key.mode === "replace" && key.value.trim()) return { apiKey: key.value.trim() };
    return {};
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    setErrors({});
    try {
      const payload = keyPayload();
      setResult(
        await testConnection({
          providerId: spec.id,
          values: vals,
          apiKey: payload.apiKey ?? undefined,
          useSavedKey: key?.mode === "saved",
        }),
      );
      void qc.invalidateQueries({ queryKey: transcriptionSettingsKey });
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setTesting(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const next = await saveTranscriptionSettings({
        activeProviderId: spec.id,
        defaultLanguage: language,
        provider: { providerId: spec.id, values: vals, ...keyPayload() },
      });
      qc.setQueryData(transcriptionSettingsKey, next);
      void qc.invalidateQueries({ queryKey: ["transcription", "status"] });
      const after = next.providers.find((p) => p.providerId === spec.id);
      setKeys((all) => ({ ...all, [spec.id]: { mode: after?.secret.configured ? "saved" : "replace", value: "" } }));
      toast.success("Transcription settings saved.");
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setSaving(false);
    }
  };

  const statusIcon = current?.status === "connected" ? <CheckCircle size={16} className="text-success" aria-hidden /> : current?.status === "failed" ? <WarningCircle size={16} className="text-danger" aria-hidden /> : null;

  return (
    <form onSubmit={save} noValidate className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <h2 className="text-lg font-semibold">Transcription</h2>
        <p className="text-sm text-muted-foreground">Recordings are transcribed by the provider you choose here. Your settings are only used for your account.</p>
      </header>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Provider</legend>
        <RadioGroup value={spec.id} onValueChange={(v) => { edited(); setProviderId(v); }} className="grid gap-2 sm:grid-cols-2" aria-label="Provider">
          {specs.map((s) => (
            <Label key={s.id} htmlFor={`provider-${s.id}`} className="flex cursor-pointer items-center gap-3 rounded-lg border border-divider bg-surface-elevated p-3 font-normal has-[[data-state=checked]]:border-primary">
              <RadioGroupItem value={s.id} id={`provider-${s.id}`} />
              <span className="grid gap-0.5">
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.fields.some((f) => f.kind === "secret") ? "Address, API key and model" : "Server address only"}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <p className="flex items-center gap-1.5 text-sm" aria-live="polite">
        {statusIcon}
        <span className="font-medium">Status:</span>
        <span>
          {current ? STATUS_TEXT[current.status] : "Not configured"}
          {current?.status === "connected" && current.testedAt ? ` · tested ${time(current.testedAt)}` : ""}
          {current?.status === "failed" && current.lastError ? `: ${current.lastError}` : ""}
        </span>
      </p>

      <div className="grid gap-4">
        {spec.fields.map((f) =>
          f.kind === "secret" ? (
            <div key={f.key} className="grid gap-2">
              <Label htmlFor={`field-${f.key}`}>{f.label}</Label>
              {key.mode === "saved" && current?.secret.configured ? (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border border-divider bg-surface-sunken px-2 py-1.5 font-mono text-sm" aria-label={`Saved API key ending in ${current.secret.last4 ?? "…"}`}>
                    ••••••••{current.secret.last4 ?? ""}
                  </code>
                  <Button type="button" variant="outline" size="sm" onClick={() => setKey({ mode: "replace", value: "" })}>Replace</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setKey({ mode: "remove", value: "" })}>Remove</Button>
                </div>
              ) : key.mode === "remove" ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>The saved key will be removed when you save.</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setKey({ mode: "saved", value: "" })}>Undo</Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={`field-${f.key}`}
                    type="password"
                    autoComplete="off"
                    className="max-w-sm"
                    value={key.value}
                    onChange={(e) => setKey({ mode: "replace", value: e.target.value })}
                    aria-invalid={errors.apiKey ? true : undefined}
                    aria-describedby={errors.apiKey ? `error-${f.key}` : undefined}
                  />
                  {current?.secret.configured && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setKey({ mode: "saved", value: "" })}>Keep saved key</Button>
                  )}
                </div>
              )}
              {errors.apiKey && <p id={`error-${f.key}`} className="text-sm text-danger">{errors.apiKey}</p>}
            </div>
          ) : (
            <div key={f.key} className="grid gap-2">
              <Label htmlFor={`field-${f.key}`}>
                {f.label}
                {!f.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
              </Label>
              <Input
                id={`field-${f.key}`}
                type={f.kind === "url" ? "url" : "text"}
                inputMode={f.kind === "url" ? "url" : undefined}
                className="max-w-md"
                placeholder={f.placeholder ?? undefined}
                value={vals[f.key] ?? ""}
                onChange={(e) => setValue(f.key, e.target.value)}
                aria-invalid={errors[f.key] ? true : undefined}
                aria-describedby={errors[f.key] ? `error-${f.key}` : undefined}
              />
              {errors[f.key] && <p id={`error-${f.key}`} className="text-sm text-danger">{errors[f.key]}</p>}
            </div>
          ),
        )}
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => void runTest()} disabled={testing}>
            {testing && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <p role="status" className="text-sm">
            {result?.ok && (
              <span className="flex items-center gap-1.5 text-success"><CheckCircle size={16} aria-hidden /> Connection works.</span>
            )}
            {result && !result.ok && (
              <span className="flex items-center gap-1.5 text-danger"><WarningCircle size={16} aria-hidden /> {result.message}</span>
            )}
          </p>
        </div>
      </div>

      <div className="grid max-w-xs gap-2">
        <Label htmlFor="default-language">Default spoken language</Label>
        <Select value={language} onValueChange={(v) => { setLanguage(v); setErrors({}); }}>
          <SelectTrigger id="default-language" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languageOptions(language).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      <div>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
