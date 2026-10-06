import { DotsThree, DownloadSimple, Plus, UploadSimple } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePreferences, useUpdatePreferences } from "@/features/sessions/api";
import { isApiError } from "@/lib/api";
import { createTheme, deleteTheme, themesKey, updateTheme, useThemes, type Theme } from "../api";
import { BUILT_IN, contrastIssues, keyColorsOf, type Base, type ColorSet } from "./colors";
import { fileName, parseFile, toFile, type ThemeData } from "./themeFile";

interface Option {
  id: string;
  name: string;
  swatches: string[];
  theme?: Theme;
  builtIn?: Base;
}

function swatchesOf(c: ColorSet) {
  return [c.surface, c["surface-elevated"], c["text-primary"], c.accent];
}

function download(data: ThemeData) {
  const url = URL.createObjectURL(new Blob([toFile(data)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(data.name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const builtInData = (base: Base): ThemeData => ({
  name: base === "dark" ? "Dark" : "Light",
  base,
  keyColors: keyColorsOf(BUILT_IN[base]),
  overrides: {},
  colors: BUILT_IN[base],
});

const themeData = (t: Theme): ThemeData => ({
  name: t.name,
  base: t.base,
  keyColors: t.keyColors as ThemeData["keyColors"],
  overrides: t.overrides as ThemeData["overrides"],
  colors: t.colors as ColorSet,
});

/** Settings → Appearance (005 US3–US5). */
export function AppearanceSettings() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const themes = useThemes();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "rename" | "delete"; theme: Theme } | null>(null);
  const [importError, setImportError] = useState<string>();

  const active = prefs.data?.theme ?? "system";
  const custom = themes.data ?? [];
  const options: Option[] = [
    { id: "light", name: "Light", swatches: swatchesOf(BUILT_IN.light), builtIn: "light" },
    { id: "dark", name: "Dark", swatches: swatchesOf(BUILT_IN.dark), builtIn: "dark" },
    { id: "system", name: "Match system", swatches: [BUILT_IN.light.surface, BUILT_IN.light.accent, BUILT_IN.dark.surface, BUILT_IN.dark.accent] },
    ...custom.map((t) => ({ id: t.id, name: t.name, swatches: swatchesOf(t.colors as ColorSet), theme: t })),
  ];

  const refresh = () => qc.invalidateQueries({ queryKey: themesKey });

  const duplicate = async (data: ThemeData) => {
    try {
      const copy = await createTheme({ ...data, name: `${data.name} copy`, lowContrast: contrastIssues(data.colors).length > 0, uniqueName: true });
      await refresh();
      navigate(`/settings/appearance/themes/${copy.id}`);
    } catch {
      toast.error("Couldn't duplicate the theme.");
    }
  };

  const importFile = async (file: File) => {
    setImportError(undefined);
    const parsed = parseFile(await file.text(), file.size);
    if (!parsed.ok) return setImportError(parsed.error);
    const low = contrastIssues(parsed.theme.colors).length > 0;
    try {
      const created = await createTheme({ ...parsed.theme, lowContrast: low, uniqueName: true });
      await refresh();
      const notes = [
        parsed.filled ? `${parsed.filled} missing colour${parsed.filled === 1 ? " was" : "s were"} filled from ${parsed.theme.base === "dark" ? "Dark" : "Light"}` : "",
        parsed.ignored ? `${parsed.ignored} unknown entr${parsed.ignored === 1 ? "y was" : "ies were"} ignored` : "",
        low ? "some colour pairs don't meet WCAG AA (marked Low contrast)" : "",
      ].filter(Boolean);
      toast.success(`Imported “${created.name}”.${notes.length ? ` Note: ${notes.join("; ")}.` : ""}`);
    } catch (err) {
      setImportError(isApiError(err) ? err.title : "Couldn't import the theme.");
    }
  };

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="text-sm text-muted-foreground">Your theme is saved to your account and used on every device.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <UploadSimple size={16} aria-hidden /> Import…
          </Button>
          <Button onClick={() => setDialog({ kind: "new" })}>
            <Plus size={16} aria-hidden /> New theme…
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-label="Theme file to import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
      </header>
      {importError && <p role="alert" className="text-sm text-danger">{importError}</p>}

      <RadioGroup
        value={active}
        onValueChange={(v) => updatePrefs.mutate({ theme: v })}
        aria-label="Theme"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {options.map((o) => (
          <div key={o.id} className="flex items-start gap-2 rounded-lg border border-divider bg-surface-elevated p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary">
            <RadioGroupItem value={o.id} id={`theme-${o.id}`} className="mt-1" />
            <Label htmlFor={`theme-${o.id}`} className="grid min-w-0 flex-1 cursor-pointer gap-2 font-normal">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate font-medium" title={o.name}>{o.name}</span>
                {active === o.id && <Badge variant="outline">Active</Badge>}
                {o.theme?.lowContrast && <Badge variant="outline">Low contrast</Badge>}
              </span>
              <span className="flex gap-1" aria-hidden>
                {o.swatches.map((c, i) => (
                  <span key={i} className="size-5 rounded border border-divider" style={{ backgroundColor: c }} />
                ))}
              </span>
            </Label>
            {o.id !== "system" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${o.name}`}>
                    <DotsThree size={18} weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {o.theme && (
                    <>
                      <DropdownMenuItem onSelect={() => navigate(`/settings/appearance/themes/${o.theme!.id}`)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDialog({ kind: "rename", theme: o.theme! })}>Rename…</DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onSelect={() => void duplicate(o.theme ? themeData(o.theme) : builtInData(o.builtIn!))}>Duplicate</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => download(o.theme ? themeData(o.theme) : builtInData(o.builtIn!))}>
                    <DownloadSimple size={14} aria-hidden /> Export
                  </DropdownMenuItem>
                  {o.theme && (
                    <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => setDialog({ kind: "delete", theme: o.theme! })}>
                      Delete…
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </RadioGroup>

      {dialog?.kind === "new" && (
        <NewThemeDialog
          themes={custom}
          onClose={() => setDialog(null)}
          onCreate={(name, from) => navigate(`/settings/appearance/themes/new?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}`)}
        />
      )}
      {dialog?.kind === "rename" && <RenameThemeDialog theme={dialog.theme} onClose={() => setDialog(null)} onDone={() => void refresh()} />}
      {dialog?.kind === "delete" && (
        <AlertDialog open onOpenChange={(o) => !o && setDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{dialog.theme.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {active === dialog.theme.id
                  ? `This is your current theme; the app switches to ${dialog.theme.base === "dark" ? "Dark" : "Light"}.`
                  : "The theme is removed from your account."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={async () => {
                  try {
                    await deleteTheme(dialog.theme.id, dialog.theme.version);
                    await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["preferences"] })]);
                    toast.success(`Deleted “${dialog.theme.name}”.`);
                  } catch {
                    toast.error("Couldn't delete the theme. Reload and try again.");
                  }
                  setDialog(null);
                }}
              >
                Delete theme
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function NewThemeDialog({ themes, onClose, onCreate }: { themes: Theme[]; onClose: () => void; onCreate: (name: string, from: string) => void }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("light");
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("Enter a name for the theme.");
    if (themes.some((t) => t.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) return setError("A theme with this name already exists.");
    onCreate(clean, from);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New theme</DialogTitle>
          <DialogDescription>Start from an existing theme and change its colours.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="new-theme-name">Name</Label>
            <Input id="new-theme-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "new-theme-error" : undefined} />
            {error && <p id="new-theme-error" className="text-sm text-danger">{error}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-theme-from">Start from</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger id="new-theme-from" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                {themes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Create and edit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameThemeDialog({ theme, onClose, onDone }: { theme: Theme; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(theme.name);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateTheme(theme.id, theme.version, {
        name: name.trim(), keyColors: theme.keyColors, overrides: theme.overrides, colors: theme.colors, lowContrast: theme.lowContrast,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(isApiError(err) ? (err.fieldMessage("/name") ?? err.title) : "Couldn't rename the theme.");
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename theme</DialogTitle>
          <DialogDescription>Choose a new name for “{theme.name}”.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="rename-theme">Name</Label>
            <Input id="rename-theme" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "rename-theme-error" : undefined} />
            {error && <p id="rename-theme-error" className="text-sm text-danger">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Rename</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
