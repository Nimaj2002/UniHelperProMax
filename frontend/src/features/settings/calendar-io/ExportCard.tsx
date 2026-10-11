import { DownloadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form/FormError";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCourseTree } from "@/features/courses/api";
import { isApiError } from "@/lib/api";
import { exportCalendar, problemMessage, saveFile } from "./api";
import { semesterOptions } from "./DestinationPicker";

const ALL = "__all__";

function counted(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Export calendar (.ics)" (010 US2): everything or one semester as one file. */
export function ExportCard() {
  const tree = useCourseTree();
  const options = semesterOptions(tree.data ?? []);
  const [scope, setScope] = useState(ALL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const scopeLabel = scope === ALL ? "your calendar" : (options.find((o) => o.id === scope)?.label ?? "this semester");

  const onExport = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const file = await exportCalendar(scope === ALL ? undefined : scope);
      saveFile(file);
      toast.success(`Exported ${counted(file.classes, "class", "classes")} and ${counted(file.events, "event", "events")}`);
    } catch (err) {
      setMessage(isApiError(err, "nothing_to_export") ? `There is nothing to export in ${scopeLabel}.` : problemMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="export-heading" className="space-y-3 rounded-lg border border-divider bg-surface-elevated p-4">
      <div className="space-y-1">
        <h3 id="export-heading" className="text-base font-semibold">
          Export calendar (.ics)
        </h3>
        <p className="text-sm text-muted-foreground">
          One file with your classes and events for Google Calendar, Apple Calendar or Outlook. Notes, recordings and documents are
          never included.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="export-scope">What to export</Label>
          <Select value={scope} onValueChange={(v) => { setScope(v); setMessage(undefined); }}>
            <SelectTrigger id="export-scope" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All years and semesters</SelectItem>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onExport} disabled={busy}>
          <DownloadSimple size={16} aria-hidden />
          {busy ? "Exporting…" : "Export calendar (.ics)"}
        </Button>
      </div>
      <FormError message={message} />
    </section>
  );
}
