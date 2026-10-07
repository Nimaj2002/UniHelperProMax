import { describe, expect, it, vi } from "vitest";
import { AUDIO_ACCEPT, checkAudioFile, formatBytes, MAX_AUDIO_BYTES } from "@/features/imports/audioFiles";
import { ImportQueue, uploadErrorMessage, type UploadEntry } from "@/features/imports/importQueue";
import { ApiError } from "@/lib/api";

const fake = (name: string, size = 1000) => ({ name, size });

describe("checkAudioFile", () => {
  it("accepts every supported extension, in any case", () => {
    for (const name of ["a.mp3", "b.MP3", "c.m4a", "d.aac", "e.wav", "f.ogg", "g.oga", "h.opus", "i.webm", "j.FLAC", ".m4a"]) {
      expect(checkAudioFile(fake(name)), name).toBeNull();
    }
    expect(AUDIO_ACCEPT).toBe(".mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.webm,.flac");
  });

  it("rejects other types, naming the file and the supported formats", () => {
    for (const name of ["notes.pdf", "video.mp4", "essay.docx", "lecture"]) {
      const problem = checkAudioFile(fake(name));
      expect(problem?.code).toBe("unsupported_type");
      expect(problem?.message).toContain(name);
      expect(problem?.message).toContain("MP3, M4A, AAC, WAV, OGG, Opus, WebM or FLAC");
    }
  });

  it("rejects files over 1 GB with their size and the limit", () => {
    expect(checkAudioFile(fake("ok.wav", MAX_AUDIO_BYTES))).toBeNull();
    const problem = checkAudioFile(fake("export.wav", 1.5 * 1024 ** 3));
    expect(problem).toEqual({ code: "file_too_large", message: "export.wav is 1.5 GB. Audio files can be at most 1 GB." });
    expect(checkAudioFile(fake("tiny.wav", MAX_AUDIO_BYTES + 1))?.code).toBe("file_too_large");
  });

  it("formats sizes for people", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(84 * 1024 * 1024)).toBe("84 MB");
    expect(formatBytes(1.4 * 1024 ** 3)).toBe("1.4 GB");
  });
});

describe("rejected files", () => {
  it("never reach the server and are shown immediately", () => {
    const upload = vi.fn();
    const q = new ImportQueue(upload, async () => undefined);
    const big = new File([new Uint8Array(1)], "export.wav");
    Object.defineProperty(big, "size", { value: MAX_AUDIO_BYTES + 1 });
    q.enqueue("s1", [new File(["%PDF"], "slides.pdf"), big]);
    const entries: UploadEntry[] = q.entries("s1"); // same tick: no await
    expect(entries.map((e) => [e.state, e.error?.code])).toEqual([
      ["rejected", "unsupported_type"],
      ["rejected", "file_too_large"],
    ]);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("uploadErrorMessage", () => {
  const msg = (err: unknown) => uploadErrorMessage(err, "lecture.mp3", 2048);

  it("maps server problems to the ui-import.md messages", () => {
    expect(msg(new ApiError(422, "unreadable_audio", "x"))).toEqual({
      code: "unreadable_audio",
      message: "lecture.mp3 couldn't be read as audio.",
      retryable: false,
    });
    expect(msg(new ApiError(507, "insufficient_storage", "x")).message).toBe("There isn't enough space on the server for lecture.mp3.");
    expect(msg(new ApiError(413, "file_too_large", "x")).message).toContain("Audio files can be at most 1 GB.");
    expect(msg(new ApiError(415, "unsupported_type", "x")).message).toContain("MP3, M4A, AAC, WAV, OGG, Opus, WebM or FLAC");
  });

  it("offers Retry only for network and server failures", () => {
    expect(msg(new ApiError(0, "network_error", "x"))).toMatchObject({ retryable: true, message: "Upload of lecture.mp3 failed — check your connection." });
    expect(msg(new ApiError(500, "internal_error", "x")).retryable).toBe(true);
    expect(msg(new TypeError("Failed to fetch")).retryable).toBe(true);
    expect(msg(new ApiError(422, "unreadable_audio", "x")).retryable).toBe(false);
    expect(msg(new ApiError(404, "not_found", "x")).retryable).toBe(false);
  });
});
