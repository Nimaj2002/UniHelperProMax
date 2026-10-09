/** PDF pre-checks done in the browser before any byte is sent (007 FR-003, FR-004, SC-002). */
import type { FileProblem } from "@/features/imports/audioFiles";
import { formatBytes, extensionOf } from "@/features/imports/audioFiles";
import { ApiError } from "@/lib/api";

export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const PDF_ACCEPT = ".pdf,application/pdf";

export function checkPdfFile(file: Pick<File, "name" | "size">): FileProblem | null {
  if (extensionOf(file.name) !== ".pdf") {
    return { code: "unsupported_type", message: `${file.name}: only PDF files can be added here.` };
  }
  if (file.size > MAX_PDF_BYTES) {
    return { code: "file_too_large", message: `${file.name} is ${formatBytes(file.size)}. PDFs can be at most 200 MB.` };
  }
  if (file.size === 0) return { code: "unreadable_pdf", message: `${file.name} couldn't be read as a PDF.` };
  return null;
}

/** The message for a failed PDF upload (contracts/ui-reader.md, 006 rules for retries). */
export function pdfUploadError(err: unknown, fileName: string, size: number): FileProblem & { retryable: boolean } {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "unsupported_type":
        return { code: err.code, message: `${fileName}: only PDF files can be added here.`, retryable: false };
      case "file_too_large":
        return { code: err.code, message: `${fileName} is ${formatBytes(size)}. PDFs can be at most 200 MB.`, retryable: false };
      case "unreadable_pdf":
        return { code: err.code, message: `${fileName} couldn't be read as a PDF.`, retryable: false };
      case "insufficient_storage":
        return { code: err.code, message: `There isn't enough space on the server for ${fileName}.`, retryable: true };
      case "not_found":
        return { code: err.code, message: `${fileName} wasn't uploaded: this session no longer exists.`, retryable: false };
      default:
        if (err.status === 0 || err.status >= 500 || err.code === "incomplete_upload") {
          return { code: err.code, message: `Upload of ${fileName} failed — check your connection.`, retryable: true };
        }
        return { code: err.code, message: `${fileName} wasn't uploaded: ${err.title}`, retryable: false };
    }
  }
  return { code: "network_error", message: `Upload of ${fileName} failed — check your connection.`, retryable: true };
}
