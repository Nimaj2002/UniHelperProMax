/** 014 US1: Settings → AI — the endpoint list, the add/edit form and custom instructions. */
import { Plus } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/lib/api";
import { KeyProtectionNotice } from "../KeyProtectionNotice";
import {
  aiEndpointsKey, aiSettingsKey, useAiEndpoints, useAiSettings, useAiStyles, useDeleteEndpoint, useSaveAiSettings, useUpdateEndpoint,
  type AiEndpoint, type AiStyle,
} from "./api";
import { EndpointForm } from "./EndpointForm";

const MAX_INSTRUCTIONS = 8000;

export function AiSettingsPage() {
  const styles = useAiStyles();
  const endpoints = useAiEndpoints();
  const [editing, setEditing] = useState<"new" | string | null>(null);

  if (styles.isPending || endpoints.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  if (!styles.data || !endpoints.data) return <p role="alert" className="text-sm text-danger">Couldn't load the settings. Reload to try again.</p>;
  const list = endpoints.data;
  const editingEndpoint = editing && editing !== "new" ? list.find((e) => e.id === editing) : undefined;

  return (
    <div className="grid max-w-3xl gap-6">
      <header className="grid gap-1">
        <h2 className="text-lg font-semibold">AI</h2>
        <p className="text-sm text-muted-foreground">
          Add the AI services you want to chat with. Nothing is set up for you; your endpoints and keys are only used for your account.
        </p>
      </header>

      <KeyProtectionNotice />

      <section aria-labelledby="ai-endpoints-heading" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="ai-endpoints-heading" className="text-base font-semibold">Endpoints</h3>
          {editing === null && (
            <Button type="button" size="sm" onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden />
              Add endpoint
            </Button>
          )}
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No endpoints yet. Add one to start chatting about your sessions.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Endpoints">
            {list.map((ep) => (
              <EndpointRow key={ep.id} endpoint={ep} styles={styles.data} disabled={editing !== null} onEdit={() => setEditing(ep.id)} />
            ))}
          </ul>
        )}
        {(editing === "new" || editingEndpoint) && (
          <EndpointForm key={editing} styles={styles.data} endpoint={editingEndpoint} onDone={() => setEditing(null)} />
        )}
      </section>

      <CustomInstructions />
    </div>
  );
}

function EndpointRow({ endpoint: ep, styles, disabled, onEdit }: { endpoint: AiEndpoint; styles: AiStyle[]; disabled: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const update = useUpdateEndpoint();
  const remove = useDeleteEndpoint();
  const styleLabel = styles.find((s) => s.id === ep.style)?.label ?? ep.style;

  const failed = (err: unknown) => {
    if (isApiError(err, "version_conflict")) {
      toast.error("This endpoint was changed elsewhere. The list was reloaded.");
      void qc.invalidateQueries({ queryKey: aiEndpointsKey });
    } else {
      toast.error(isApiError(err) ? (err.detail ?? err.title) : "Couldn't reach the server. Try again.");
    }
  };

  const toggle = (enabled: boolean) =>
    update.mutate({ id: ep.id, version: ep.version, body: { enabled } }, { onError: failed });

  const del = () =>
    remove.mutate({ id: ep.id, version: ep.version }, { onSuccess: () => toast.success(`Deleted "${ep.name}".`), onError: failed });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-divider bg-surface-elevated p-3">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{ep.name}</span>
          <span className="text-sm text-muted-foreground">{styleLabel}</span>
          <Badge variant="outline">{ep.locality === "local" ? "Local" : "Remote"}</Badge>
        </div>
        <span className="truncate font-mono text-xs text-muted-foreground">{ep.baseUrl}</span>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={ep.enabled} disabled={update.isPending} onCheckedChange={toggle} aria-label={`Enable ${ep.name}`} />
        <span className="text-sm text-muted-foreground" aria-hidden>{ep.enabled ? "Enabled" : "Disabled"}</span>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onEdit} aria-label={`Edit ${ep.name}`}>
        Edit
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`Delete ${ep.name}`}>
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{ep.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Chats that used it keep their history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button type="button" variant="destructive" onClick={del} disabled={remove.isPending}>Delete</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** FR-060: sent as the system instruction of every chat (PUT /ai/settings with its version). */
function CustomInstructions() {
  const qc = useQueryClient();
  const settings = useAiSettings();
  const save = useSaveAiSettings();
  const saved = settings.data?.customInstructions ?? "";
  const [value, setValue] = useState<string | null>(null);
  const text = value ?? saved;
  const dirty = value !== null && value !== saved;

  const submit = () => {
    if (!settings.data || !dirty) return;
    save.mutate(
      { version: settings.data.version, customInstructions: text },
      {
        onSuccess: () => {
          setValue(null);
          toast.success("Custom instructions saved.");
        },
        onError: (err) => {
          if (isApiError(err, "version_conflict")) {
            toast.error("The instructions were changed elsewhere. They were reloaded; your text is kept.");
            void qc.invalidateQueries({ queryKey: aiSettingsKey });
          } else toast.error(isApiError(err) ? (err.detail ?? err.title) : "Couldn't save the instructions. Try again.");
        },
      },
    );
  };

  return (
    <section aria-labelledby="ai-instructions-heading" className="grid gap-2">
      <h3 id="ai-instructions-heading" className="text-base font-semibold">Custom instructions</h3>
      <p id="ai-instructions-help" className="text-sm text-muted-foreground">
        Sent with every chat message as the system instruction — for example "Answer briefly, in English."
      </p>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          id="ai-instructions"
          value={text}
          disabled={!settings.data}
          maxLength={MAX_INSTRUCTIONS}
          rows={4}
          onChange={(e) => setValue(e.target.value)}
          aria-labelledby="ai-instructions-heading"
          aria-describedby="ai-instructions-help ai-instructions-count"
        />
        <div className="flex items-center justify-between gap-2">
          <span id="ai-instructions-count" className="text-xs text-muted-foreground">
            {text.length.toLocaleString("en-US")} / {MAX_INSTRUCTIONS.toLocaleString("en-US")}
          </span>
          <Button type="submit" size="sm" disabled={!dirty || save.isPending} aria-label="Save instructions">
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}
