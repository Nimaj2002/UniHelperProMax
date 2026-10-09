/** The app-wide PDF upload queue (007): same mechanics as audio imports (006). */
import { ImportQueue, registerQueue } from "@/features/imports/importQueue";
import { importDocument, type Document } from "./api";
import { checkPdfFile, pdfUploadError } from "./pdfFiles";

let shared: ImportQueue<Document> | null = null;

export function documentQueue(): ImportQueue<Document> {
  shared ??= registerQueue(
    new ImportQueue<Document>(importDocument, async () => undefined, 2, 250, () => Date.now(), {
      check: checkPdfFile,
      errorMessage: pdfUploadError,
    }),
  );
  return shared;
}
