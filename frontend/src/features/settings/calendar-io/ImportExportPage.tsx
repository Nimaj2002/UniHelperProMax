import { ExportTasksCard } from "@/features/tasks/ExportTasksCard";
import { ExportCard } from "./ExportCard";
import { ImportWizard } from "./ImportWizard";

/** Settings → Import and export (feature 010): calendar files (and, 012, a CSV of the tasks) — notes, recordings,
 * documents and annotations are never imported or exported. */
export function ImportExportPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Import and export</h2>
        <p className="text-sm text-muted-foreground">Move your schedule between this app and other calendar apps.</p>
      </div>
      <section aria-labelledby="import-heading" className="space-y-3 rounded-lg border border-divider bg-surface-elevated p-4">
        <div className="space-y-1">
          <h3 id="import-heading" className="text-base font-semibold">
            Import calendar (.ics)
          </h3>
          <p className="text-sm text-muted-foreground">
            Classes and events from Google Calendar, Apple Calendar, Outlook or a file exported here. Notes, recordings and
            documents are never imported.
          </p>
        </div>
        <ImportWizard />
      </section>
      <ExportCard />
      <ExportTasksCard />
    </div>
  );
}
