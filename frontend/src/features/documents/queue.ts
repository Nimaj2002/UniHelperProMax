/** The app-wide PDF upload queue (007): same mechanics as audio imports (006). */
import { ImportQueue, registerQueue } from "@/features/imports/importQueue";
import { importDocument, type Document } from "./api";
import { tourEvents } from "@/features/tour/events";
import { checkPdfFile, pdfUploadError } from "./pdfFiles";

let shared: ImportQueue<Document> | null = null;

export function documentQueue(): ImportQueue<Document> {
  if (!shared) {
    shared = registerQueue(
      new ImportQueue<Document>(importDocument, async () => undefined, 2, 250, () => Date.now(), {
        check: checkPdfFile,
        errorMessage: pdfUploadError,
      }),
    );
    // 023: Yuii cheers an added PDF and notices a rejected or failed upload (an event listener,
    // because routes.tsx owns the single onUploaded slot)
    shared.onEvent((e) => {
      if (e.type === "done") tourEvents.emit("document.added");
      else if (e.type === "failed" || e.type === "rejected") tourEvents.emit("action.failed", { kind: "upload" });
    });
  }
  return shared;
}
