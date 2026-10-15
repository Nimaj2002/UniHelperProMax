import { ArrowLeft, ArrowRight, DotsThree, PencilSimple, Trash } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export const NAME_MAX = 40;
export const NAME_TAKEN = "A column with this name already exists";
export const NAME_TOO_LONG = `Names can be at most ${NAME_MAX} characters`;
export const NAME_REQUIRED = "A column needs a name";
export const MAX_COLUMNS = 12;
export const COLUMN_LIMIT = `A board holds at most ${MAX_COLUMNS} columns`;
export const LAST_COLUMN = "The board needs at least one column";

/** The message for a failed column create/rename (409 `name_taken`, 422 validation). */
export function columnNameError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "name_taken") return NAME_TAKEN;
    if (err.code === "column_limit") return COLUMN_LIMIT;
    if (err.status === 422) return NAME_TOO_LONG;
  }
  return "Couldn't save the column";
}

interface NameInputProps {
  label: string;
  initial?: string;
  /** Resolves when saved; a rejection shows its message under the field. */
  onSave: (name: string) => Promise<unknown>;
  /** Saved, cancelled (Escape) or left. */
  onDone: () => void;
  className?: string;
}

/** Inline column-name field for Rename and Add column: Enter saves, Escape cancels. */
export function ColumnNameInput({ label, initial = "", onSave, onDone, className }: NameInputProps) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = useId();

  const save = async () => {
    const text = name.trim();
    if (!text) return setError(NAME_REQUIRED);
    if (text.length > NAME_MAX) return setError(NAME_TOO_LONG);
    if (text === initial) return onDone();
    setSaving(true);
    try {
      await onSave(text);
      onDone();
    } catch (err) {
      setError(columnNameError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- shown on request to type a name
        autoFocus
        value={name}
        aria-label={label}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={saving}
        className="h-7 text-sm"
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
        onBlur={() => {
          if (!saving && !error) onDone();
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface MenuProps {
  name: string;
  countsAsDone: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  /** False for the only column (FR-010). */
  canDelete: boolean;
  onRename: () => void;
  onToggleDone: (value: boolean) => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDelete: () => void;
}

/** A column header's menu (FR-009): Rename, Counts as done, Move left/right, Delete. */
export function ColumnMenu(props: MenuProps) {
  const { name, countsAsDone, canMoveLeft, canMoveRight, canDelete } = props;
  // Rename focuses its field: the menu must not pull focus back to its trigger
  const keepFocus = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Column actions for ${name}`}>
          <DotsThree size={16} weight="bold" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onCloseAutoFocus={(e) => {
          if (keepFocus.current) e.preventDefault();
          keepFocus.current = false;
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            keepFocus.current = true;
            props.onRename();
          }}
        >
          <PencilSimple aria-hidden />
          Rename
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={countsAsDone} onCheckedChange={(v) => props.onToggleDone(v === true)}>
          Counts as done
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canMoveLeft} onSelect={props.onMoveLeft}>
          <ArrowLeft aria-hidden />
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveRight} onSelect={props.onMoveRight}>
          <ArrowRight aria-hidden />
          Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={!canDelete} onSelect={props.onDelete} className="items-start">
          <Trash aria-hidden className="mt-0.5" />
          <span className="flex flex-col">
            Delete
            {!canDelete && <span className="text-xs text-muted-foreground">{LAST_COLUMN}</span>}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
