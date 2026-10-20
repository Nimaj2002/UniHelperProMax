/**
 * 014 FR-038 (contracts/ui-contract.md "Model picker"): the message box's model button and its
 * list, grouped by endpoint with a Local/Remote badge and capability icons; a search box when there
 * are more than 8 models. Models that are hidden or whose endpoint is disabled are left out.
 */
import { CaretDown, Check, FilePdf, Image as ImageIcon, MagnifyingGlass, Microphone } from "@phosphor-icons/react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AiCapabilities } from "@/features/settings/ai/api";
import type { Schemas } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ModelRef } from "./api";
import { sameRef, type ModelChoice } from "./models";

type ContextItem = Schemas["ContextItem"];

const SEARCH_FROM = 8;
const CAPS: { key: keyof AiCapabilities; label: string; Icon: typeof ImageIcon }[] = [
  { key: "images", label: "Accepts images", Icon: ImageIcon },
  { key: "pdf", label: "Accepts PDF documents", Icon: FilePdf },
  { key: "audio", label: "Accepts audio", Icon: Microphone },
];

/** Attachments a model can't take (notes are text and always accepted). */
export function unaccepted(items: ContextItem[], caps: AiCapabilities | undefined): ContextItem[] {
  if (!caps) return [];
  return items.filter((i) => {
    const mime = i.mime ?? "";
    if (i.kind === "recording" || mime.startsWith("audio/")) return !caps.audio;
    if (i.kind === "document" && i.pdfMode !== "text") return !caps.pdf;
    if (mime === "application/pdf" && i.pdfMode !== "text") return !caps.pdf;
    if (mime.startsWith("image/")) return !caps.images;
    return false;
  });
}

interface Props {
  choices: ModelChoice[];
  value: ModelChoice | undefined;
  /** The chat's model label when its model is gone (deleted, hidden or disabled). */
  missingLabel?: string;
  onChange: (ref: ModelRef) => void;
  /** Items in context, checked against the chosen model's capabilities. */
  attachments?: ContextItem[];
  onRemoveAttachment?: (item: ContextItem) => void;
  /** The items a model can't take, from the server's preflight (US9); else checked here. */
  check?: (ref: ModelRef) => Promise<ContextItem[]>;
  /** Called when the list closes, to give focus back to the message box. */
  onClosed?: () => void;
  disabled?: boolean;
}

export function ModelPicker({ choices, value, missingLabel, onChange, attachments = [], onRemoveAttachment, check, onClosed, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [warn, setWarn] = useState<{ items: ContextItem[]; name: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? choices.filter((c) => `${c.model.displayName} ${c.model.modelId} ${c.endpoint.name}`.toLowerCase().includes(needle)) : choices;
  }, [choices, q]);
  const groups = useMemo(() => {
    const out: { endpoint: ModelChoice["endpoint"]; items: { c: ModelChoice; i: number }[] }[] = [];
    shown.forEach((c, i) => {
      const g = out.find((x) => x.endpoint.id === c.endpoint.id);
      if (g) g.items.push({ c, i });
      else out.push({ endpoint: c.endpoint, items: [{ c, i }] });
    });
    return out;
  }, [shown]);

  const locality = (c: ModelChoice) => (c.endpoint.locality === "local" ? "Local" : "Remote");
  const label = value ? `Model: ${value.model.displayName}, ${locality(value)}` : missingLabel ? `Model: ${missingLabel} (unavailable), choose a model` : "Model: choose a model";
  const optionId = (i: number) => `${id}-opt-${i}`;

  const choose = (c: ModelChoice) => {
    setOpen(false);
    setQ("");
    if (!sameRef(c.ref, value?.ref)) {
      onChange(c.ref);
      if (check)
        void check(c.ref).then((bad) => {
          if (bad.length) setWarn({ items: bad, name: c.model.displayName });
        });
      else {
        const bad = unaccepted(attachments, c.model.capabilities);
        if (bad.length) setWarn({ items: bad, name: c.model.displayName });
      }
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (!shown.length) return;
    const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (move) {
      e.preventDefault();
      const next = (active + move + shown.length) % shown.length;
      setActive(next);
      document.getElementById(optionId(next))?.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : shown.length - 1);
    } else if (e.key === "Enter" || (e.key === " " && e.target === listRef.current)) {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    }
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setActive(Math.max(0, shown.findIndex((c) => sameRef(c.ref, value?.ref))));
          else setQ("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={label}
            className="h-7 max-w-[60%] min-w-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{value?.model.displayName ?? missingLabel ?? "Choose a model"}</span>
            {value && (
              <span aria-hidden className="shrink-0 rounded-full border border-divider px-1.5 text-[11px] leading-4">
                {locality(value)}
              </span>
            )}
            <CaretDown size={12} aria-hidden className="shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="w-72 p-1"
          onCloseAutoFocus={(e) => {
            if (onClosed) {
              e.preventDefault();
              onClosed();
            }
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (document.getElementById(`${id}-search`) ?? listRef.current)?.focus();
          }}
        >
          {choices.length > SEARCH_FROM && (
            <div className="relative mb-1">
              <MagnifyingGlass size={14} aria-hidden className="absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground" />
              <input
                id={`${id}-search`}
                type="search"
                role="searchbox"
                aria-label="Search models"
                aria-controls={`${id}-list`}
                aria-activedescendant={shown[active] ? optionId(active) : undefined}
                placeholder="Search models"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKey}
                className="h-8 w-full rounded-md border border-input bg-transparent pr-2 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
          <div
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-label="Models"
            tabIndex={0}
            aria-activedescendant={shown[active] ? optionId(active) : undefined}
            onKeyDown={onKey}
            className="max-h-72 overflow-y-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {!shown.length && <p className="px-2 py-3 text-sm text-muted-foreground">No models match.</p>}
            {groups.map(({ endpoint, items }) => (
              <div key={endpoint.id} role="group" aria-label={endpoint.name} className="py-1">
                <div aria-hidden className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                  <span className="truncate">{endpoint.name}</span>
                  <span className="shrink-0 rounded-full border border-divider px-1.5 text-[11px] leading-4">
                    {endpoint.locality === "local" ? "Local" : "Remote"}
                  </span>
                </div>
                {items.map(({ c, i }) => {
                  const selected = sameRef(c.ref, value?.ref);
                  return (
                    <div
                      key={c.model.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      onKeyDown={onKey}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(c)}
                      className={cn(
                        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                        i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                      )}
                    >
                      <Check size={14} aria-hidden className={cn("shrink-0", !selected && "invisible")} />
                      <span className="min-w-0 flex-1 truncate">{c.model.displayName}</span>
                      {CAPS.filter((k) => c.model.capabilities[k.key]).map(({ key, label: capLabel, Icon }) => (
                        <span key={key} role="img" aria-label={capLabel} title={capLabel} className="shrink-0 text-muted-foreground">
                          <Icon size={14} aria-hidden />
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={!!warn} onOpenChange={(o) => !o && setWarn(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{warn?.name} can't take some attachments</AlertDialogTitle>
            <AlertDialogDescription>Remove them, or choose a model that accepts them. They won't be sent to this model.</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="grid gap-1">
            {warn?.items.map((item) => (
              <li key={`${item.kind}:${item.ref}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{item.title}</span>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Remove ${item.title}`}
                  onClick={() => {
                    onRemoveAttachment?.(item);
                    setWarn((w) => {
                      const items = w?.items.filter((x) => x !== item) ?? [];
                      return items.length ? { ...w!, items } : null;
                    });
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => setWarn(null)}>Done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
