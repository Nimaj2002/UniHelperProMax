/** Feature 004 wiring: Transcribe + status on each recording, activity bar item, notifications. */
import { registerActivity, registerActivitySignal, registerGlobalHost } from "@/app/shell/registry";
import { useActiveTranscription } from "./api";
import { registerRecordingExtension } from "@/features/recordings/extensions";
import { TranscribeButton } from "./TranscribeButton";
import { TranscriptionBar } from "./TranscriptionBar";
import { TranscriptionNotifier } from "./TranscriptionNotifier";
import { TranscriptionStatus } from "./TranscriptionStatus";

registerRecordingExtension({ id: "transcription", Action: TranscribeButton, Details: TranscriptionStatus });
registerActivity({ id: "transcription-bar", component: TranscriptionBar, priority: 1 });
registerActivitySignal({
  id: "transcription",
  kind: "transcription",
  description: "transcription running",
  priority: 1,
  useActive: () => !!useActiveTranscription().data,
});
registerGlobalHost({ id: "transcription-notifier", component: TranscriptionNotifier });

export const routes = [];
