import { DotsThree } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Field } from "@/components/form/Field";
import { FormError } from "@/components/form/FormError";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import {
  conflictMessage, fetchDeletionImpact, useDeleteHierarchy, useUpdateHierarchy,
  type DeletionImpact, type HierarchyKind,
} from "./api";

export interface MenuTarget {
  kind: HierarchyKind;
  id: string;
  name: string;
  version: number;
  startDate?: string | null;
  endDate?: string | null;
}

const NOUN: Record<HierarchyKind, string> = { year: "year", semester: "semester", course: "course" };

interface Props {
  target: MenuTarget;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export function HierarchyMenu({ target, onMoveUp, onMoveDown, canMoveUp, canMoveDown }: Props) {
  const [dialog, setDialog] = useState<"rename" | "dates" | "delete" | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-70 hover:opacity-100" aria-label={`Actions for ${target.name}`}>
            <DotsThree size={18} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("rename")}>Rename…</DropdownMenuItem>
          {target.kind === "year" && (
            <>
              <DropdownMenuItem disabled={!canMoveUp} onSelect={onMoveUp}>Move up</DropdownMenuItem>
              <DropdownMenuItem disabled={!canMoveDown} onSelect={onMoveDown}>Move down</DropdownMenuItem>
            </>
          )}
          {target.kind === "semester" && <DropdownMenuItem onSelect={() => setDialog("dates")}>Edit dates…</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => setDialog("delete")}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "rename" && <RenameDialog target={target} onClose={() => setDialog(null)} />}
      {dialog === "dates" && <DatesDialog target={target} onClose={() => setDialog(null)} />}
      {dialog === "delete" && <DeleteDialog target={target} onClose={() => setDialog(null)} />}
    </>
  );
}

function RenameDialog({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const update = useUpdateHierarchy();
  const [name, setName] = useState(target.name);
  const [error, setError] = useState<string>();
  const max = target.kind === "course" ? 120 : 80;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a name.");
    update.mutate(
      { kind: target.kind, id: target.id, version: target.version, body: { name } },
      {
        onSuccess: () => { toast.success("Renamed. Its folder was renamed too."); onClose(); },
        onError: (err) => setError(conflictMessage(err)),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename {NOUN[target.kind]}</DialogTitle>
          <DialogDescription>The matching folder on disk is renamed as well.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field label="Name" error={error}>
            <Input maxLength={max} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={update.isPending}>Rename</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DatesDialog({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const update = useUpdateHierarchy();
  const [start, setStart] = useState(target.startDate ?? "");
  const [end, setEnd] = useState(target.endDate ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (start && end && end < start) return setErrors({ end: "The semester must end on or after it starts." });
    update.mutate(
      { kind: "semester", id: target.id, version: target.version, body: { startDate: start || null, endDate: end || null } },
      {
        onSuccess: () => { toast.success("Semester dates saved"); onClose(); },
        onError: (err) =>
          setErrors(isApiError(err) && err.fieldMessage("/endDate") ? { end: err.fieldMessage("/endDate")! } : { form: conflictMessage(err) }),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dates for {target.name}</DialogTitle>
          <DialogDescription>Classes that repeat “until the semester ends” follow the end date.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <FormError message={errors.form} />
          <Field label="Starts (optional)"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Ends (optional)" error={errors.end}><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={update.isPending}>Save dates</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function impactSentence(kind: HierarchyKind, impact: DeletionImpact): string {
  const parts: string[] = [];
  if (impact.semesters) parts.push(plural(impact.semesters, "semester"));
  if (impact.courses) parts.push(plural(impact.courses, "course"));
  if (impact.classes) parts.push(plural(impact.classes, "class"));
  return parts.length ? `This also removes ${parts.join(", ")} from the app.` : `This ${NOUN[kind]} is empty.`;
}

function DeleteDialog({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const del = useDeleteHierarchy();
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    fetchDeletionImpact(target.kind, target.id).then(
      (r) => live && setImpact(r),
      (err) => live && setError(conflictMessage(err)),
    );
    return () => {
      live = false;
    };
  }, [target.kind, target.id]);
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {target.name}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-2">
              {impact ? <p>{impactSentence(target.kind, impact)}</p> : !error && <p>Checking what this includes…</p>}
              {impact && (
                <p>
                  Notes and recordings are never deleted: they stay in the folder{" "}
                  <span className="font-medium text-foreground">“{impact.keptFolder}”</span> on disk.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!impact || del.isPending}
            onClick={() =>
              del.mutate(
                { kind: target.kind, id: target.id, version: target.version },
                {
                  onSuccess: () => { toast.success(`Deleted “${target.name}”. Files were kept.`); onClose(); },
                  onError: (err) => setError(conflictMessage(err)),
                },
              )
            }
          >
            Delete {NOUN[target.kind]}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
