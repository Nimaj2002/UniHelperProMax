/** How the rest of the app reaches the Media Editor (025): one icon, one URL; the page itself loads lazily. */
import { Faders } from "@phosphor-icons/react";

export const MediaEditorIcon = Faders;
export const MEDIA_EDITOR_HREF = "/media-editor";
export const mediaEditorHref = (recordingId?: string) =>
  recordingId ? `${MEDIA_EDITOR_HREF}?recording=${encodeURIComponent(recordingId)}` : MEDIA_EDITOR_HREF;
