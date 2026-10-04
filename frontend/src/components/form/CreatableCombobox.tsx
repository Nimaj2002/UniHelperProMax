import { CaretUpDown, Check, Plus } from "@phosphor-icons/react";
import { forwardRef, useState, type ComponentPropsWithoutRef } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type Pick = { kind: "existing"; id: string; name: string } | { kind: "new"; name: string } | null;

interface Props extends Omit<ComponentPropsWithoutRef<"button">, "onChange" | "value"> {
  items: { id: string; name: string }[];
  value: Pick;
  onChange: (value: Pick) => void;
  placeholder: string;
  noun: string;
  loading?: boolean;
}

/** Pick an existing item or create a new one by typing its name (FR-014). */
export const CreatableCombobox = forwardRef<HTMLButtonElement, Props>(function CreatableCombobox(
  { items, value, onChange, placeholder, noun, loading, disabled, className, ...rest },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typed = query.replace(/\s+/g, " ").trim();
  const exact = items.find((i) => i.name.toLocaleLowerCase() === typed.toLocaleLowerCase());
  const label = value ? (value.kind === "new" ? `${value.name} (new)` : value.name) : placeholder;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
          {...rest}
        >
          <span className="truncate">{label}</span>
          <CaretUpDown size={16} aria-hidden className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command shouldFilter>
          <CommandInput placeholder={`Search or create a ${noun}…`} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{loading ? "Loading…" : typed ? null : `No ${noun}s yet. Type a name to create one.`}</CommandEmpty>
            {items.length > 0 && (
              <CommandGroup heading={`Existing ${noun}s`}>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.id}`}
                    onSelect={() => {
                      onChange({ kind: "existing", id: item.id, name: item.name });
                      setOpen(false);
                    }}
                  >
                    <Check
                      size={16}
                      aria-hidden
                      className={cn(value?.kind === "existing" && value.id === item.id ? "opacity-100" : "opacity-0")}
                    />
                    {item.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {typed && !exact && (
              <CommandGroup heading="New">
                <CommandItem
                  value={`__create__ ${typed}`}
                  onSelect={() => {
                    onChange({ kind: "new", name: typed });
                    setOpen(false);
                  }}
                >
                  <Plus size={16} aria-hidden />
                  Create “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
