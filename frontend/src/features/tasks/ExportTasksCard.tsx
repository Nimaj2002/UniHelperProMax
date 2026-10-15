import { DownloadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveFile } from "@/features/settings/calendar-io/api";
import { API_BASE } from "@/lib/api";

function fileNameOf(disposition: string | null): string {
  const match = /filename="([^"]+)"/.exec(disposition ?? "");
  return match?.[1] ?? "UniHelperProMax-tasks.csv";
}

/** `GET /tasks/export` as a file (CSV, not JSON). */
export async function exportTasks(): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`${API_BASE}/tasks/export`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  return { blob: await response.blob(), fileName: fileNameOf(response.headers.get("Content-Disposition")) };
}

/** Settings → Import and export: "Export tasks" (012 FR-053), one CSV row per task. */
export function ExportTasksCard() {
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const file = await exportTasks();
      saveFile({ ...file, classes: 0, events: 0 });
      toast.success("Tasks exported");
    } catch {
      toast.error("Couldn't export the tasks. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="export-tasks-heading" className="space-y-3 rounded-lg border border-divider bg-surface-elevated p-4">
      <div className="space-y-1">
        <h3 id="export-tasks-heading" className="text-base font-semibold">
          Export tasks (.csv)
        </h3>
        <p className="text-sm text-muted-foreground">
          One spreadsheet file with every task: its column, course, due date, checklist and description.
        </p>
      </div>
      <Button onClick={onExport} disabled={busy}>
        <DownloadSimple size={16} aria-hidden />
        {busy ? "Exporting…" : "Export tasks"}
      </Button>
    </section>
  );
}
