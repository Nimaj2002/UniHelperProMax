import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, isApiError } from "@/lib/api";
import { meKey, useMe, type Me } from "./api";

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

export function TimeZoneDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const choose = async (tz: string) => {
    setSaving(true);
    try {
      const updated = await apiFetch<Me>("/auth/profile", { method: "PATCH", body: { timezone: tz } });
      qc.setQueryData(meKey, updated);
      await qc.invalidateQueries({ queryKey: ["sessions"] });
      toast.success(`Time zone set to ${tz}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(isApiError(err) ? err.title : "Couldn't change the time zone.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Time zone</DialogTitle>
          <DialogDescription>Class times are shown and repeated in this time zone. Current: {me?.timezone}</DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Search time zones…" disabled={saving} />
          <CommandList className="max-h-72">
            <CommandEmpty>No matching time zone.</CommandEmpty>
            {zones().map((tz) => (
              <CommandItem key={tz} value={tz} onSelect={() => choose(tz)} aria-current={tz === me?.timezone || undefined}>
                {tz.replaceAll("_", " ")}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
