/**
 * Choosing a tag (020 FR-043): a searchable list with "Create tag" for the typed name. A tag is
 * always its name with a colour dot, never colour alone (FR-040).
 */
import { CaretDown, Check, Plus, Tag as TagIcon, X } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCreateTag, useTags, type Tag } from "./api";
import { TAG_COLORS, tagDot } from "./tagColors";

export function TagLabel({ tag, className }: { tag: { name: string; color: string | null } | null | undefined; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={tagDot(tag?.color)} />
      <span className="truncate">{tag?.name ?? "No tag"}</span>
    </span>
  );
}

interface Props {
  value: string | null;
  onChange: (tagId: string | null) => void;
  disabled?: boolean;
  className?: string;
}

export function TagPicker({ value, onChange, disabled, className }: Props) {
  const tags = useTags().data ?? [];
  const create = useCreateTag();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = tags.find((t) => t.id === value);
  const name = query.trim();
  const exact = tags.some((t) => t.name.toLowerCase() === name.toLowerCase());

  const createTag = () => {
    // the next colour in the palette, so new tags differ from the last ones
    const color = TAG_COLORS[tags.length % TAG_COLORS.length]!;
    create.mutate(
      { name, color: color as Tag["color"] },
      {
        onSuccess: (tag) => {
          onChange(tag.id);
          setQuery("");
          setOpen(false);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.title : "Couldn't create the tag."),
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn("h-8 min-w-0 justify-between gap-1 px-2 font-normal", className)}
          aria-label={current ? `Tag: ${current.name}. Change tag` : "Choose a tag"}
        >
          {current ? (
            <TagLabel tag={current} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <TagIcon size={14} aria-hidden /> Tag
            </span>
          )}
          <CaretDown size={12} aria-hidden className="shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or create a tag" value={query} onValueChange={setQuery} maxLength={30} />
          <CommandList>
            <CommandEmpty>{name ? "No matching tag." : "No tags yet."}</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem value="__none" onSelect={() => (onChange(null), setOpen(false))}>
                  <X size={14} aria-hidden /> No tag
                </CommandItem>
              )}
              {tags.map((t) => (
                <CommandItem key={t.id} value={t.name} onSelect={() => (onChange(t.id), setOpen(false))}>
                  <TagLabel tag={t} className="flex-1" />
                  {t.id === value && <Check size={14} aria-label="Selected" />}
                </CommandItem>
              ))}
              {name && !exact && (
                <CommandItem value={`__create ${name}`} onSelect={createTag} disabled={create.isPending}>
                  <Plus size={14} aria-hidden /> Create tag “{name}”
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
