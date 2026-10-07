/** Audio import pre-checks done in the browser before any byte is sent (006 FR-003, FR-004, SC-002). */

/** Same list as the server's `audio_probe.ACCEPTED_EXTENSIONS` (research I3). */
export const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".webm", ".flac"] as const;
export const AUDIO_ACCEPT = AUDIO_EXTENSIONS.join(",");
export const MAX_AUDIO_BYTES = 1024 * 1024 * 1024; // 1 GB
export const SUPPORTED_FORMATS_TEXT = "MP3, M4A, AAC, WAV, OGG, Opus, WebM or FLAC";

export interface FileProblem {
  code: string;
  message: string;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** Sizes as people read them: binary units, labelled KB/MB/GB like most file managers. */
export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${bytes} bytes`;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function unsupportedTypeMessage(name: string): string {
  return `${name}: this file type isn't supported. Use ${SUPPORTED_FORMATS_TEXT}.`;
}

export function tooLargeMessage(name: string, size?: number): string {
  return size === undefined
    ? `${name} is larger than 1 GB. Audio files can be at most 1 GB.`
    : `${name} is ${formatBytes(size)}. Audio files can be at most 1 GB.`;
}

/** `null` when the file may be uploaded; otherwise why not (no request is ever sent for it). */
export function checkAudioFile(file: Pick<File, "name" | "size">): FileProblem | null {
  if (!(AUDIO_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
    return { code: "unsupported_type", message: unsupportedTypeMessage(file.name) };
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return { code: "file_too_large", message: tooLargeMessage(file.name, file.size) };
  }
  if (file.size === 0) {
    return { code: "unreadable_audio", message: `${file.name} couldn't be read as audio.` };
  }
  return null;
}

/**
 * Duration as the browser sees it, sent only as a fallback for files that don't record their
 * length (research I4). A browser that can't decode a valid format must not block the upload,
 * so failure resolves to `undefined`, never a rejection.
 */
export function probeDuration(file: Blob, timeoutMs = 5000): Promise<number | undefined> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(undefined);
      return;
    }
    let settled = false;
    const finish = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    audio.addEventListener("loadedmetadata", () =>
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : undefined),
    );
    audio.addEventListener("error", () => finish(undefined));
    audio.src = url;
  });
}
