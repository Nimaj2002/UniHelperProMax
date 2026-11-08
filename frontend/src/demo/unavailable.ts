/** 024: actions the browser demo can't do (contracts/demo-mode.md §3) → toast + 403 problem. */
import { toast } from "sonner";
import { problem } from "./http";

export const DOWNLOAD_URL = "https://www.unihelperpromax.tech/#download";

export function demoUnavailable(label: string) {
  const detail = `${label} is available in the UniHelperProMax app.`;
  toast(detail, {
    id: `demo-unavailable-${label}`,
    action: { label: "Download", onClick: () => window.open(DOWNLOAD_URL, "_blank", "noopener") },
  });
  return problem(403, "demo_unavailable", "Not available in the demo", detail);
}
