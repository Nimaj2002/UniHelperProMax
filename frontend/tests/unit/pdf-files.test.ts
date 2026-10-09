import { describe, expect, it, vi } from "vitest";
import { ImportQueue } from "@/features/imports/importQueue";
import { checkPdfFile, MAX_PDF_BYTES, pdfUploadError } from "@/features/documents/pdfFiles";
import { ApiError } from "@/lib/api";

const fake = (name: string, size = 1000) => ({ name, size });

describe("checkPdfFile", () => {
  it("accepts .pdf in any case", () => {
    expect(checkPdfFile(fake("slides.pdf"))).toBeNull();
    expect(checkPdfFile(fake("SLIDES.PDF"))).toBeNull();
  });

  it("refuses other types with the file name", () => {
    for (const name of ["slides.pptx", "slides.pdf.exe", "slides"]) {
      expect(checkPdfFile(fake(name))).toEqual({ code: "unsupported_type", message: `${name}: only PDF files can be added here.` });
    }
  });

  it("refuses files over 200 MB with their size and the limit, and empty files", () => {
    expect(checkPdfFile(fake("ok.pdf", MAX_PDF_BYTES))).toBeNull();
    expect(checkPdfFile(fake("scan.pdf", MAX_PDF_BYTES + 1))).toEqual({
      code: "file_too_large",
      message: "scan.pdf is 200 MB. PDFs can be at most 200 MB.", // rounds; still names size and limit
    });
    expect(checkPdfFile(fake("big.pdf", 240 * 1024 * 1024))?.message).toBe("big.pdf is 240 MB. PDFs can be at most 200 MB.");
    expect(checkPdfFile(fake("empty.pdf", 0))?.code).toBe("unreadable_pdf");
  });

  it("rejected files never reach the upload function", () => {
    const upload = vi.fn();
    const q = new ImportQueue(upload, async () => undefined, 2, 250, () => Date.now(), { check: checkPdfFile, errorMessage: pdfUploadError });
    q.enqueue("s1", [new File(["x"], "deck.pptx")]);
    expect(q.entries("s1")[0]).toMatchObject({ state: "rejected", error: { code: "unsupported_type" } });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("pdfUploadError", () => {
  const msg = (err: unknown) => pdfUploadError(err, "slides.pdf", 2048);
  it("maps server problems to messages, with Retry only for network and server failures", () => {
    expect(msg(new ApiError(422, "unreadable_pdf", "x"))).toEqual({ code: "unreadable_pdf", message: "slides.pdf couldn't be read as a PDF.", retryable: false });
    expect(msg(new ApiError(415, "unsupported_type", "x")).message).toBe("slides.pdf: only PDF files can be added here.");
    expect(msg(new ApiError(507, "insufficient_storage", "x"))).toMatchObject({ retryable: true });
    expect(msg(new ApiError(0, "network_error", "x"))).toMatchObject({ retryable: true, message: "Upload of slides.pdf failed — check your connection." });
    expect(msg(new ApiError(404, "not_found", "x")).retryable).toBe(false);
  });
});
