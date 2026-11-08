/** 024: operations answered with "available in the app" (contracts/demo-mode.md §3). */
import { http, type HttpHandler } from "msw";
import { API } from "../http";
import { demoUnavailable } from "../unavailable";

const rows: [label: string, ops: [method: keyof typeof http, path: string][]][] = [
  [
    "Recording",
    [
      ["post", "/sessions/:key/recordings"],
      ["put", "/recordings/:id/chunks/:seq"],
      ["post", "/recordings/:id/stop"],
    ],
  ],
  [
    "File upload",
    [
      ["post", "/sessions/:key/recordings/import"],
      ["post", "/sessions/:key/documents/import"],
      ["post", "/sessions/:key/chat-uploads"],
      ["put", "/notes/:id/import-replace"],
      ["all", "/calendar-imports"],
      ["all", "/calendar-imports/*"],
    ],
  ],
  [
    "AI provider setup",
    [
      ["post", "/ai/base-url/check"],
      ["post", "/ai/endpoints"],
      ["post", "/ai/endpoints/test"],
      ["post", "/ai/endpoints/models/discover"],
      ["patch", "/ai/endpoints/:id"],
      ["delete", "/ai/endpoints/:id"],
      ["post", "/ai/endpoints/:id/privacy-ack"],
    ],
  ],
  [
    "Transcription & proxy setup",
    [
      ["put", "/settings/transcription"],
      ["post", "/settings/transcription/test"],
      ["put", "/settings/proxy"],
      ["delete", "/settings/proxy"],
      ["post", "/settings/proxy/test"],
      ["post", "/secrets/reset"],
    ],
  ],
  ["Backup", [["all", "/backup/*"]]],
  [
    "Account",
    [
      ["post", "/auth/login"],
      ["post", "/auth/logout"],
      ["post", "/auth/password"],
      ["post", "/setup/owner"],
      ["all", "/admin/*"],
    ],
  ],
  ["Desktop", [["all", "/desktop/*"]]],
];

export const handlers: HttpHandler[] = rows.flatMap(([label, ops]) =>
  ops.map(([method, path]) => (http[method] as typeof http.all)(`${API}${path}`, () => demoUnavailable(label))),
);
