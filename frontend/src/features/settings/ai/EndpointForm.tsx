/** 014 US1: add or edit one AI endpoint (FR-014…FR-019). Test connection and Refresh use the
 *  draft and never save; everything is saved together with Save. */
import {
  CheckCircle, CircleNotch, Clock, Key, LockSimpleOpen, MagnifyingGlass, PlugsConnected, Question, WarningCircle, type Icon,
} from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ApiError } from "@/lib/api";
import { initialKeyDraft, KeyField, keyPayload, type KeyDraft } from "../KeyField";
import {
  checkBaseUrl, discoverModels, testEndpoint, useCreateEndpoint, useUpdateEndpoint,
  type AiEndpoint, type AiEndpointTest, type AiStyle, type AiStyleId, type AiTestResult, type BaseUrlResult,
} from "./api";
import { fromDraft, ModelList, toDraft, type ModelDraft } from "./ModelList";

const OUTCOME: Record<AiTestResult["outcome"], { title: string; icon: Icon; tone: string }> = {
  working: { title: "Working", icon: CheckCircle, tone: "text-success" },
  key_rejected: { title: "Key rejected", icon: Key, tone: "text-danger" },
  model_not_found: { title: "Model not found", icon: MagnifyingGlass, tone: "text-danger" },
  unreachable: { title: "Address unreachable", icon: PlugsConnected, tone: "text-danger" },
  timeout: { title: "No answer in time", icon: Clock, tone: "text-danger" },
  not_this_style: { title: "Doesn't look like this style", icon: Question, tone: "text-warning" },
  https_required: { title: "https required", icon: LockSimpleOpen, tone: "text-danger" },
  provider: { title: "Provider error", icon: WarningCircle, tone: "text-danger" },
};

const FIELDS = new Set(["name", "style", "baseUrl", "apiKey", "models"]);

type Check = { style: AiStyleId; url: string; result?: BaseUrlResult; error?: string };

export function maskedKeyLabel(masked: string | null | undefined) {
  const tail = (masked ?? "").replace(/^•+/, "");
  return tail ? `Saved API key ending in ${tail}` : "Saved API key";
}

interface EndpointFormProps {
  styles: AiStyle[];
  /** The endpoint being edited; absent when adding. */
  endpoint?: AiEndpoint;
  onDone: () => void;
}

export function EndpointForm({ styles, endpoint, onDone }: EndpointFormProps) {
  const create = useCreateEndpoint();
  const update = useUpdateEndpoint();
  const [name, setName] = useState(endpoint?.name ?? "");
  const [style, setStyle] = useState<AiStyleId>(endpoint?.style ?? styles[0]?.id ?? "openai");
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? "");
  const [key, setKey] = useState<KeyDraft>(() => initialKeyDraft(endpoint?.key));
  const [models, setModels] = useState<ModelDraft[]>(() => (endpoint?.models ?? []).map(toDraft));
  const [testModel, setTestModel] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);

  const spec = styles.find((s) => s.id === style) ?? styles[0];
  const url = baseUrl.trim();

  // FR-015/FR-016: normalise as the student types (300 ms debounce)
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      checkBaseUrl({ style, baseUrl: url }, ctrl.signal).then(
        (res) => setCheck({ style, url, result: res }),
        (err: unknown) => {
          if (ctrl.signal.aborted) return;
          const message = err instanceof ApiError ? (err.fieldMessage("baseUrl") ?? err.detail ?? err.title) : undefined;
          setCheck({ style, url, error: message });
        },
      );
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [style, url]);
  const current = url && check?.url === url && check.style === style ? check : null;

  const edited = () => {
    setResult(null); // any change invalidates the last test
    setErrors({});
  };

  const fieldErrors = (err: unknown) => {
    if (!(err instanceof ApiError)) return { form: "Couldn't reach the server. Try again." };
    if (err.code === "name_taken") return { name: err.title };
    const out: Record<string, string> = {};
    for (const e of err.errors) {
      const field = e.field.split("/")[1] ?? "";
      out[FIELDS.has(field) ? field : "form"] = e.message;
    }
    if (!err.errors.length) out.form = err.detail ?? err.title;
    return out;
  };

  const draft = (): AiEndpointTest => ({
    style,
    baseUrl: url,
    ...(key.mode === "replace" ? keyPayload(key) : {}),
    ...(key.mode === "saved" && endpoint?.key.configured ? { useSavedKeyOf: endpoint.id } : {}),
  });

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    setErrors({});
    try {
      setResult(await testEndpoint({ ...draft(), ...(testModel.trim() ? { modelId: testModel.trim() } : {}) }));
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setTesting(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!name.trim()) missing.name = "Enter a name.";
    if (!url) missing.baseUrl = "Enter the base URL.";
    if (Object.keys(missing).length) return setErrors(missing);
    setSaving(true);
    setErrors({});
    const body = { name: name.trim(), style, baseUrl: url, ...keyPayload(key), models: models.map(fromDraft) };
    try {
      if (endpoint) await update.mutateAsync({ id: endpoint.id, version: endpoint.version, body });
      else await create.mutateAsync({ ...body, enabled: true });
      toast.success("Endpoint saved.");
      onDone();
    } catch (err) {
      setErrors(err instanceof ApiError && err.status === 412
        ? { form: "This endpoint was changed elsewhere. Cancel and open it again." }
        : fieldErrors(err));
    } finally {
      setSaving(false);
    }
  };

  const baseUrlError = errors.baseUrl ?? current?.error;
  const outcome = result ? OUTCOME[result.outcome] : null;
  const lookedLike = result?.looksLike ? styles.find((s) => s.id === result.looksLike)?.label : undefined;

  return (
    <form onSubmit={save} noValidate aria-label={endpoint ? `Edit ${endpoint.name}` : "Add endpoint"} className="grid gap-5 rounded-lg border border-divider bg-surface p-4">
      <h3 className="text-base font-semibold">{endpoint ? `Edit ${endpoint.name}` : "Add endpoint"}</h3>

      <div className="grid gap-2">
        <Label htmlFor="ai-name">Name</Label>
        <Input
          id="ai-name"
          className="max-w-sm"
          maxLength={60}
          value={name}
          onChange={(e) => { edited(); setName(e.target.value); }}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "ai-name-error" : undefined}
        />
        {errors.name && <p id="ai-name-error" className="text-sm text-danger">{errors.name}</p>}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Style</legend>
        <RadioGroup value={style} onValueChange={(v) => { edited(); setStyle(v as AiStyleId); }} className="grid gap-2 sm:grid-cols-3" aria-label="Style">
          {styles.map((s) => (
            <Label key={s.id} htmlFor={`ai-style-${s.id}`} className="flex cursor-pointer items-start gap-3 rounded-lg border border-divider bg-surface-elevated p-3 font-normal has-[[data-state=checked]]:border-primary">
              <RadioGroupItem value={s.id} id={`ai-style-${s.id}`} className="mt-0.5" />
              <span className="grid min-w-0 gap-0.5">
                <span className="font-medium">{s.label}</span>
                {s.exampleBaseUrls.map((u) => (
                  <span key={u} className="truncate font-mono text-xs text-muted-foreground">{u}</span>
                ))}
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="ai-base-url">Base URL</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="ai-base-url"
            type="url"
            inputMode="url"
            className="max-w-md"
            placeholder={spec?.exampleBaseUrls[0]}
            value={baseUrl}
            onChange={(e) => { edited(); setBaseUrl(e.target.value); }}
            aria-invalid={baseUrlError ? true : undefined}
            aria-describedby="ai-base-url-note"
          />
          {current?.result && (
            <Badge variant="outline">{current.result.locality === "local" ? "Local" : "Remote"}</Badge>
          )}
        </div>
        <div id="ai-base-url-note" aria-live="polite" className="grid gap-1 text-sm">
          {baseUrlError ? (
            <p className="text-danger">{baseUrlError}</p>
          ) : current?.result?.removedPath ? (
            <p className="text-muted-foreground">Removed {current.result.removedPath} — the app adds it</p>
          ) : null}
        </div>
      </div>

      <KeyField
        id="ai-api-key"
        label={<>API key<span className="font-normal text-muted-foreground"> (optional for local endpoints)</span></>}
        saved={endpoint?.key}
        maskedLabel={maskedKeyLabel(endpoint?.key.masked)}
        draft={key}
        onChange={(next) => { edited(); setKey(next); }}
        error={errors.apiKey}
      />

      <div className="grid gap-2">
        <Label htmlFor="ai-test-model">
          Model to test<span className="font-normal text-muted-foreground"> (optional)</span>
        </Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="ai-test-model"
            className="max-w-xs"
            value={testModel}
            onChange={(e) => { edited(); setTestModel(e.target.value); }}
          />
          <Button type="button" variant="outline" onClick={() => void runTest()} disabled={testing}>
            {testing && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />}
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>
        <div role="status" className="grid gap-1 text-sm">
          {result && outcome && (
            <>
              <p className={`flex items-start gap-1.5 ${outcome.tone}`} data-outcome={result.outcome}>
                <outcome.icon size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium">{outcome.title}.</span> {result.message}
                  {result.modelCount != null && ` ${result.modelCount} ${result.modelCount === 1 ? "model" : "models"} listed.`}
                  {lookedLike && ` It looks like ${lookedLike}.`}
                </span>
              </p>
              {result.hint && <p className="text-muted-foreground">{result.hint}</p>}
            </>
          )}
        </div>
      </div>

      {spec && (
        <ModelList
          style={style}
          defaults={spec.defaultCapabilities}
          models={models}
          onChange={(next) => { setErrors({}); setModels(next); }}
          discover={() => discoverModels(draft())}
          error={errors.models}
        />
      )}

      {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
