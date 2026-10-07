import { ArrowCounterClockwise, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { isApiError } from "@/lib/api";
import { createTheme, themesKey, updateTheme, useThemes, type Theme } from "../api";
import { ColorField } from "./ColorField";
import {
  BUILT_IN, contrastIssues, formatRatio, KEY_COLORS, KEY_LABELS, keyColorsOf, resolve, TOKEN_LABELS, TOKENS,
  type Base, type ColorSet, type KeyColors, type Token,
} from "./colors";
import { presetById } from "./presets";
import { ThemePreview } from "./ThemePreview";

interface Draft {
  name: string;
  base: Base;
  keyColors: KeyColors;
  overrides: Partial<ColorSet>;
}

function fromTheme(t: Theme): Draft {
  return { name: t.name, base: t.base, keyColors: t.keyColors as KeyColors, overrides: t.overrides as Partial<ColorSet> };
}

/** Create or edit a custom theme (005 US4): key colours, Advanced overrides, live preview and
 * WCAG AA warnings. Built-in themes are never edited here (they can only be duplicated). */
export function ThemeEditor() {
  const { themeId } = useParams();
  const [params] = useSearchParams();
  const themes = useThemes();
  if (themes.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  const list = themes.data ?? [];
  const editing = themeId ? list.find((t) => t.id === themeId) : undefined;
  if (themeId && !editing) {
    return (
      <p role="alert" className="text-sm">
        This theme no longer exists. <Link to="/settings/appearance" className="text-primary underline underline-offset-4">Back to Appearance</Link>
      </p>
    );
  }
  let initial: Draft;
  if (editing) initial = fromTheme(editing);
  else {
    const from = params.get("from") ?? "light";
    const source = list.find((t) => t.id === from);
    const preset = presetById(from);
    const base: Base = source ? source.base : preset ? preset.base : from === "dark" ? "dark" : "light";
    initial = source
      ? { ...fromTheme(source), name: params.get("name") ?? "" }
      : preset
        ? { name: params.get("name") ?? "", base, keyColors: preset.keyColors, overrides: {} }
        : { name: params.get("name") ?? "", base, keyColors: keyColorsOf(BUILT_IN[base]), overrides: {} };
  }
  return <Editor key={themeId ?? "new"} initial={initial} existing={editing} />;
}

function Editor({ initial, existing }: { initial: Draft; existing?: Theme }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial);
  const [advanced, setAdvanced] = useState(Object.keys(initial.overrides).length > 0);
  const [keptNotice, setKeptNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmLow, setConfirmLow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const colors = useMemo(() => resolve(draft.base, draft.keyColors, draft.overrides), [draft]);
  const issues = useMemo(() => contrastIssues(colors), [colors]);
  const dirty = !saved && JSON.stringify(draft) !== JSON.stringify(initial);
  const leaving = useRef(false); // set once saved, before navigating away
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const overrideCount = Object.keys(draft.overrides).length;

  const setKey = (k: (typeof KEY_COLORS)[number], hex: string) => {
    setDraft((d) => ({ ...d, keyColors: { ...d.keyColors, [k]: hex } }));
    setKeptNotice(overrideCount ? `${overrideCount} colour${overrideCount === 1 ? "" : "s"} you set by hand ${overrideCount === 1 ? "was" : "were"} kept.` : undefined);
  };
  const setOverride = (t: Token, hex: string) => setDraft((d) => ({ ...d, overrides: { ...d.overrides, [t]: hex } }));
  const resetOverride = (t: Token) =>
    setDraft((d) => {
      const next = { ...d.overrides };
      delete next[t];
      return { ...d, overrides: next };
    });

  const persist = async (): Promise<boolean> => {
    setSaving(true);
    setError(undefined);
    const body = { name: draft.name.trim(), keyColors: draft.keyColors, overrides: draft.overrides, colors, lowContrast: issues.length > 0 };
    try {
      if (existing) await updateTheme(existing.id, existing.version, body);
      else await createTheme({ ...body, base: draft.base });
      await qc.invalidateQueries({ queryKey: themesKey });
      leaving.current = true;
      setSaved(true);
      toast.success(`Theme “${body.name}” saved.`);
      return true;
    } catch (err) {
      setError(
        isApiError(err, "version_conflict")
          ? "This theme was changed in another window. Reload to see the latest version."
          : isApiError(err)
            ? (err.fieldMessage("/name") ?? err.title)
            : "Couldn't save the theme. Please retry.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    setConfirmLow(false);
    if (await persist()) navigate("/settings/appearance");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return setError("Enter a name for the theme.");
    if (issues.length) return setConfirmLow(true); // confirm before saving a failing theme
    await finish();
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">{existing ? `Edit “${existing.name}”` : "New theme"}</h2>
          <p className="text-sm text-muted-foreground">Based on {draft.base === "dark" ? "Dark" : "Light"}. Changes show in the preview right away.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => navigate("/settings/appearance")}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save theme"}</Button>
        </div>
      </header>

      <div className="grid max-w-sm gap-2">
        <Label htmlFor="theme-name">Name</Label>
        <Input id="theme-name" maxLength={60} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid content-start gap-4">
          <div className="flex items-center gap-2">
            <Switch id="theme-advanced" checked={advanced} onCheckedChange={setAdvanced} />
            <Label htmlFor="theme-advanced">Advanced — set every colour</Label>
          </div>
          {!advanced && (
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">Key colours</legend>
              <p className="text-xs text-muted-foreground">All other colours are worked out from these four.</p>
              {KEY_COLORS.map((k) => (
                <ColorField key={k} label={KEY_LABELS[k]} value={draft.keyColors[k]} onChange={(hex) => setKey(k, hex)} />
              ))}
              {keptNotice && <p role="status" className="text-xs text-muted-foreground">{keptNotice}</p>}
            </fieldset>
          )}
          {advanced && (
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">All colours</legend>
              {TOKENS.map((t) => (
                <div key={t} className="grid gap-1">
                  <ColorField label={TOKEN_LABELS[t]} value={colors[t]} onChange={(hex) => setOverride(t, hex)} hint={draft.overrides[t] ? "Overridden" : undefined} />
                  {draft.overrides[t] && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 justify-self-start" onClick={() => resetOverride(t)}>
                      <ArrowCounterClockwise size={14} aria-hidden /> Reset {TOKEN_LABELS[t].toLowerCase()}
                    </Button>
                  )}
                </div>
              ))}
            </fieldset>
          )}
        </div>
        <div className="grid content-start gap-4">
          <ThemePreview colors={colors} base={draft.base} />
          <section aria-labelledby="contrast-heading" className="grid gap-2">
            <h3 id="contrast-heading" className="text-sm font-medium">Contrast (WCAG AA)</h3>
            <div role="status" className="grid gap-1 text-sm">
              {issues.length === 0 ? (
                <p className="flex items-center gap-1.5"><CheckCircle size={16} className="text-success" aria-hidden /> All colour pairs meet WCAG AA.</p>
              ) : (
                <ul className="grid gap-1">
                  {issues.map((i) => (
                    <li key={i.pair.label} className="flex items-start gap-1.5">
                      <WarningCircle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                      <span>{i.pair.label} — {formatRatio(i.ratio)}, needs {i.pair.min}:1</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      <AlertDialog open={confirmLow} onOpenChange={setConfirmLow}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save a low-contrast theme?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                <p>These colour pairs don't meet WCAG AA, so some text may be hard to read:</p>
                <ul className="list-disc pl-5">
                  {issues.map((i) => <li key={i.pair.label}>{i.pair.label} — {formatRatio(i.ratio)}, needs {i.pair.min}:1</li>)}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button type="button" onClick={() => void finish()}>Save as low contrast</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes to this theme?</AlertDialogTitle>
            <AlertDialogDescription>You have unsaved colour changes.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Keep editing</AlertDialogCancel>
            <Button type="button" variant="outline" onClick={() => blocker.proceed?.()}>Discard</Button>
            <Button
              type="button"
              onClick={async () => {
                if (draft.name.trim() && (await persist())) blocker.proceed?.();
                else blocker.reset?.();
              }}
            >
              Save
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
