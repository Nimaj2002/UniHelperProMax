/** Feature 004 wiring: Transcribe + status on each recording, activity bar item, notifications. */
import { registerActivity, registerGlobalHost } from "@/app/shell/registry";
import { registerRecordingExtension } from "@/features/recordings/extensions";
import { TranscribeButton } from "./TranscribeButton";
import { TranscriptionBar } from "./TranscriptionBar";
import { TranscriptionNotifier } from "./TranscriptionNotifier";
import { TranscriptionStatus } from "./TranscriptionStatus";

registerRecordingExtension({ id: "transcription", Action: TranscribeButton, Details: TranscriptionStatus });
registerActivity({ id: "transcription-bar", component: TranscriptionBar, priority: 1 });
registerGlobalHost({ id: "transcription-notifier", component: TranscriptionNotifier });

export const routes = [];
