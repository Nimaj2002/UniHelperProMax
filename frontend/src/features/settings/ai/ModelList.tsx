/** 014 US1 (FR-018): an endpoint's models. Refresh merges the fetched candidates into the form;
 *  everything stays local until the endpoint is saved. */
import { ArrowsClockwise, CircleNotch, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { isApiError } from "@/lib/api";
import type { AiCapabilities, AiDiscoverResult, AiModelInput, AiStyleId } from "./api";

/** A model row in the form; `rowKey` is local only and never sent. */
export type ModelDraft = AiModelInput & { rowKey: string };

let rowSeq = 0;
export const toDraft = (m: AiModelInput): ModelDraft => ({ ...m, rowKey: `m${++rowSeq}` });
export const fromDraft = ({ rowKey: _rowKey, ...m }: ModelDraft): AiModelInput => m;

/** Keep local edits for models already in the form, add the new ones. */
export function mergeCandidates(current: ModelDraft[], candidates: AiModelInput[]): ModelDraft[] {
  const known = new Set(current.map((m) => m.modelId));
  return [...current, ...candidates.filter((c) => !known.has(c.modelId)).map(toDraft)];
}

const CAPS: { key: keyof AiCapabilities; label: string }[] = [
  { key: "images", label: "Images" },
  { key: "pdf", label: "PDF documents" },
  { key: "audio", label: "Audio" },
];

interface ModelListProps {
  style: AiStyleId;
  defaults: AiCapabilities;
  models: ModelDraft[];
  onChange: (models: ModelDraft[]) => void;
  /** Refresh: fetch the candidates for the current draft; saves nothing. */
  discover: () => Promise<AiDiscoverResult>;
  error?: string;
}

export function ModelList({ style, defaults, models, onChange, discover, error }: ModelListProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [addError, setAddError] = useState<string>();
  const noAudio = style === "anthropic";

  const update = (rowKey: string, patch: Partial<AiModelInput>) =>
    onChange(models.map((m) => (m.rowKey === rowKey ? { ...m, ...patch } : m)));

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const res = await discover();
      if (res.outcome === "working") {
        const merged = mergeCandidates(models, res.models);
        const added = merged.length - models.length;
        onChange(merged);
        setNotice(added ? `Found ${res.models.length} models, ${added} new.` : `Found ${res.models.length} models, none new.`);
      } else if (res.outcome === "no_model_list") {
        setNotice(res.message ?? "This endpoint has no model list. Use Add model ID with the exact identifier.");
      } else {
        setNotice(res.message ?? "Couldn't fetch the models.");
      }
    } catch (err) {
      setNotice(isApiError(err) ? (err.errors[0]?.message ?? err.detail ?? err.title) : "Couldn't reach the server. Try again.");
    } finally {
      setRefreshing(false);
    }
  };

  const add = () => {
    const id = newId.trim();
    if (!id) return setAddError("Enter the exact model ID.");
    if (models.some((m) => m.modelId === id)) return setAddError("This model is already in the list.");
    onChange([
      ...models,
      toDraft({ modelId: id, displayName: id, capabilities: { ...defaults, audio: defaults.audio && !noAudio }, hidden: false, source: "manual" }),
    ]);
    setNewId("");
    setAddError(undefined);
  };

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Models</legend>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowsClockwise size={16} aria-hidden />}
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">{notice}</p>
      </div>

      {models.length === 0 ? (
        <p className="text-sm text-muted-foreground">No models yet. Refresh the list, or add a model by its exact ID.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Models">
          {models.map((m) => (
            <li key={m.rowKey} className="grid gap-3 rounded-lg border border-divider bg-surface-elevated p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid min-w-48 flex-1 gap-1">
                  <Label htmlFor={`${m.rowKey}-name`}>Display name</Label>
                  <Input
                    id={`${m.rowKey}-name`}
                    value={m.displayName}
                    maxLength={80}
                    aria-describedby={`${m.rowKey}-id`}
                    onChange={(e) => update(m.rowKey, { displayName: e.target.value })}
                  />
                  <code id={`${m.rowKey}-id`} className="truncate font-mono text-xs text-muted-foreground">{m.modelId}</code>
                </div>
                <div className="grid w-40 gap-1">
                  <Label htmlFor={`${m.rowKey}-context`}>
                    Context limit<span className="font-normal text-muted-foreground"> (optional)</span>
                  </Label>
                  <Input
                    id={`${m.rowKey}-context`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={m.contextLimit ?? ""}
                    onChange={(e) => update(m.rowKey, { contextLimit: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : null })}
                  />
                </div>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${m.modelId}`} onClick={() => onChange(models.filter((x) => x.rowKey !== m.rowKey))}>
                  <Trash size={16} aria-hidden />
                  Remove
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {CAPS.map((c) => {
                  const off = c.key === "audio" && noAudio;
                  const id = `${m.rowKey}-${c.key}`;
                  return (
                    <div key={c.key} className="flex items-center gap-2">
                      <Switch
                        id={id}
                        checked={off ? false : m.capabilities[c.key]}
                        disabled={off}
                        aria-describedby={off ? `${id}-why` : undefined}
                        onCheckedChange={(v) => update(m.rowKey, { capabilities: { ...m.capabilities, [c.key]: v } })}
                      />
                      <Label htmlFor={id} className="font-normal">{c.label}</Label>
                      {off && <span id={`${id}-why`} className="text-xs text-muted-foreground">Anthropic doesn't accept audio</span>}
                    </div>
                  );
                })}
                <div className="flex items-center gap-2">
                  <Switch id={`${m.rowKey}-hidden`} checked={m.hidden} onCheckedChange={(v) => update(m.rowKey, { hidden: v })} />
                  <Label htmlFor={`${m.rowKey}-hidden`} className="font-normal">Hide</Label>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid gap-1">
        <Label htmlFor="ai-new-model">Model ID</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="ai-new-model"
            className="max-w-sm"
            placeholder="e.g. llama3.1:8b"
            value={newId}
            onChange={(e) => { setNewId(e.target.value); setAddError(undefined); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            aria-invalid={addError ? true : undefined}
            aria-describedby={addError ? "ai-new-model-error" : undefined}
          />
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus size={16} aria-hidden />
            Add model ID
          </Button>
        </div>
        {addError && <p id="ai-new-model-error" className="text-sm text-danger">{addError}</p>}
      </div>
    </fieldset>
  );
}
