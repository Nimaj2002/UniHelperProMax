import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $dfs } from "@lexical/utils";
import { ShieldWarning } from "@phosphor-icons/react";
import { $getRoot } from "lexical";
import { useEffect, useId, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { contrast } from "@/features/settings/themes/colors";
import { diagramHash, getDecision, setDecision, useDecisionsVersion } from "./decisions";
import { classify, diagramConfig, type DiagramFlags } from "./directives";
import { useNoteId } from "./editorContext";
import { $isDiagramNode } from "./nodes/DiagramNode";

interface Pending {
  hash: string;
  name: string;
  flags: DiagramFlags;
  lowContrast: boolean;
}

/** Mermaid's built-in themes: "dark" has light text, the others dark text. */
const DARK_TEXT_THEMES = new Set(["default", "base", "forest", "neutral"]);

/** Any CSS colour as #rrggbb, or null where the browser can't tell (tests). */
function toHex(colour: string): string | null {
  const ctx = document.createElement("canvas").getContext?.("2d");
  if (!ctx || !colour) return null;
  ctx.fillStyle = "transparent";
  ctx.fillStyle = colour; // an invalid colour leaves "transparent" in place
  return /^#[0-9a-f]{6}$/i.test(ctx.fillStyle) ? ctx.fillStyle : null;
}

/** Would the diagram's own text colour fail AA against the note background? (FR-028a) */
function failsContrast(source: string): boolean {
  const config = diagramConfig(source);
  const vars = (config.themeVariables ?? {}) as Record<string, unknown>;
  const own = vars.textColor ?? vars.primaryTextColor;
  const appDark = document.documentElement.dataset.theme === "dark";
  if (own === undefined) {
    // a named theme: its text is light (dark theme) or dark (the rest)
    const theme = String(config.theme ?? "default");
    return theme === "dark" ? !appDark : DARK_TEXT_THEMES.has(theme) && appDark;
  }
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--editor-surface").trim();
  const [t, b] = [toHex(String(own)), toHex(bg)];
  return !!t && !!b && contrast(t, b) < 4.5;
}

function usePending(): Pending[] {
  const [editor] = useLexicalComposerContext();
  const noteId = useNoteId();
  const [sources, setSources] = useState<Array<{ source: string; info: string }>>([]);
  const version = useDecisionsVersion();
  useEffect(() => {
    const read = () =>
      editor.getEditorState().read(() => {
        const found: Array<{ source: string; info: string }> = [];
        for (const { node } of $dfs($getRoot())) if ($isDiagramNode(node)) found.push({ source: node.getSource(), info: node.getInfo() });
        setSources((prev) => (JSON.stringify(prev) === JSON.stringify(found) ? prev : found));
      });
    read();
    return editor.registerUpdateListener(read);
  }, [editor]);
  return useMemo(() => {
    if (!noteId) return [];
    return sources.flatMap(({ source, info }, i) => {
      const flags = classify(source);
      if (flags.unsafe.length === 0 && flags.theme.length === 0) return [];
      const hash = diagramHash(source, info);
      const d = getDecision(noteId, hash);
      const open = (flags.unsafe.length > 0 && !d?.unsafe) || (flags.theme.length > 0 && !d?.theme);
      if (!open) return [];
      return [{ hash, flags, name: flags.title ?? `Diagram ${i + 1}`, lowContrast: flags.theme.length > 0 && failsContrast(source) }];
    });
    // `version` changes whenever an answer is stored
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, noteId, version]);
}

type Answers = Record<string, { unsafe?: "allow" | "safe"; theme?: "own" | "app" }>;

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <legend className="sr-only">{label}</legend>
      <RadioGroup value={value} onValueChange={onChange} className="flex flex-wrap gap-4" aria-label={label}>
        {options.map(([v, text]) => (
          <div key={v} className="flex items-center gap-2">
            <RadioGroupItem value={v} id={`${id}-${v}`} />
            <Label htmlFor={`${id}-${v}`} className="font-normal">
              {text}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

/**
 * A banner, once each time the note is opened, when diagrams ask for unsafe settings or their own
 * theme (FR-032, FR-028a). Until the user answers, those diagrams are drawn safely, in the app theme.
 */
export function DecisionBanner() {
  const noteId = useNoteId();
  const pending = usePending();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});

  if (!noteId || (pending.length === 0 && !open)) return null;

  const answer = (hash: string, key: "unsafe" | "theme", value: string) =>
    setAnswers((a) => ({ ...a, [hash]: { ...a[hash], [key]: value } }));
  const all = (key: "unsafe" | "theme", value: string) =>
    setAnswers((a) => Object.fromEntries(pending.map((p) => [p.hash, { ...a[p.hash], [key]: value }])));
  const anyUnsafe = pending.some((p) => p.flags.unsafe.length > 0);
  const anyTheme = pending.some((p) => p.flags.theme.length > 0);

  const apply = () => {
    for (const p of pending) {
      const a = answers[p.hash] ?? {};
      setDecision(noteId, p.hash, {
        ...(p.flags.unsafe.length ? { unsafe: a.unsafe ?? "safe" } : {}),
        ...(p.flags.theme.length ? { theme: a.theme ?? "app" } : {}),
      });
    }
    setAnswers({});
  };

  return (
    <>
      {!dismissed && pending.length > 0 && (
        <div data-uh="diagram-decision-banner" role="status" className="mx-6 mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm">
          <ShieldWarning size={18} aria-hidden="true" className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            {pending.length === 1
              ? "A diagram in this note asks for extra permissions. Until you decide, it's drawn safely in the app's theme."
              : `${pending.length} diagrams in this note ask for extra permissions. Until you decide, they're drawn safely in the app's theme.`}
          </span>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Review
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Not now
          </Button>
        </div>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-uh="diagram-decision" className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>This note's diagrams ask for extra permissions</AlertDialogTitle>
            <AlertDialogDescription>
              Diagrams can carry their own settings. Unsafe ones can run code, open links or load files from the internet; allow them only for
              diagrams you trust. Your answers are kept in this browser, not in the note.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pending.length > 1 && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Apply to all</p>
              {anyUnsafe && (
                <Choice label="Unsafe settings, all diagrams" value="" onChange={(v) => all("unsafe", v)} options={[["safe", "Draw all safely"], ["allow", "Allow all"]]} />
              )}
              {anyTheme && (
                <Choice label="Diagram themes, all diagrams" value="" onChange={(v) => all("theme", v)} options={[["app", "Keep app theme for all"], ["own", "Use each diagram's theme"]]} />
              )}
            </div>
          )}
          <ul className="space-y-3">
            {pending.map((p) => (
              <li key={p.hash} className="space-y-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">{p.name}</p>
                {p.flags.unsafe.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm text-text-muted">Unsafe settings: {p.flags.unsafe.join(", ")}</p>
                    <Choice
                      label={`Unsafe settings of ${p.name}`}
                      value={answers[p.hash]?.unsafe ?? "safe"}
                      onChange={(v) => answer(p.hash, "unsafe", v)}
                      options={[["safe", "Draw safely"], ["allow", "Allow"]]}
                    />
                  </div>
                )}
                {p.flags.theme.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm text-text-muted">Own theme or colours: {p.flags.theme.join(", ")}</p>
                    <Choice
                      label={`Theme of ${p.name}`}
                      value={answers[p.hash]?.theme ?? "app"}
                      onChange={(v) => answer(p.hash, "theme", v)}
                      options={[["app", "Keep app theme"], ["own", "Use diagram theme"]]}
                    />
                    {p.lowContrast && (
                      <p className="text-sm text-danger" role="note">
                        This diagram's own colours may be hard to read on the note's background (below WCAG AA contrast).
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={apply}>Apply</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
