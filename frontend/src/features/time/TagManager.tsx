/**
 * Managing tags in Time mode (020 US6): rename, recolour, delete. Deleting asks first and says how
 * many entries use the tag; they stay, untagged (FR-042).
 */
import { Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDeleteTag, usePatchTag, useTags, type Tag } from "./api";
import { colorLabel, TAG_COLORS, tagDot } from "./tagColors";

export function TagManager({ onClose }: { onClose: () => void }) {
  const tags = useTags().data ?? [];
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const remove = useDeleteTag();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tags</DialogTitle>
          <DialogDescription>Create tags when you choose one for a timer. Rename and colour changes apply everywhere.</DialogDescription>
        </DialogHeader>
        {tags.length === 0 ? (
          <p className="text-sm text-text-muted">No tags yet.</p>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
            {tags.map((t) => (
              <TagRow key={`${t.id}:${t.version}`} tag={t} onDelete={() => setDeleting(t)} />
            ))}
          </ul>
        )}
        <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete the tag “{deleting?.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleting?.entryCount
                  ? `${deleting.entryCount} ${deleting.entryCount === 1 ? "entry uses" : "entries use"} this tag. They stay, without a tag.`
                  : "No entries use this tag."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleting && remove.mutate(deleting, { onError: () => toast.error("Couldn't delete the tag.") })}
              >
                Delete tag
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function TagRow({ tag, onDelete }: { tag: Tag; onDelete: () => void }) {
  const patch = usePatchTag();
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const save = (change: { name?: string; color?: Tag["color"] }) =>
    patch.mutate(
      { tag, patch: change },
      {
        onSuccess: () => setError(null),
        onError: (err) => {
          setError(err instanceof ApiError ? err.title : "Couldn't save the tag.");
          setName(tag.name);
        },
      },
    );
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-divider p-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-3 shrink-0 rounded-full" style={tagDot(tag.color)} />
        <Input
          value={name}
          maxLength={30}
          aria-label={`Name of tag ${tag.name}`}
          className="h-8 min-w-0 flex-1"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== tag.name && save({ name })}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
        <span className="shrink-0 text-xs text-text-muted">{tag.entryCount} entries</span>
        <Button size="icon" variant="ghost" className="size-7" aria-label={`Delete tag ${tag.name}`} onClick={onDelete}>
          <Trash size={14} aria-hidden />
        </Button>
      </div>
      <div role="radiogroup" aria-label={`Colour of tag ${tag.name}`} className="flex flex-wrap gap-1">
        {TAG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={tag.color === c}
            aria-label={colorLabel(c)}
            title={colorLabel(c)}
            onClick={() => tag.color !== c && save({ color: c as Tag["color"] })}
            className={cn("size-5 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring", tag.color === c && "ring-2 ring-text-primary ring-offset-1 ring-offset-surface-elevated")}
            style={tagDot(c)}
          />
        ))}
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </li>
  );
}
