/** 024: read-only settings — nothing configured, no keys (contracts/demo-mode.md §2). Writes are in unavailable.ts. */
import { http, type HttpHandler } from "msw";
import { API, json, type Res } from "../http";

export const handlers: HttpHandler[] = [
  http.get(`${API}/settings/proxy`, () => json<Res<"/api/v1/settings/proxy", "get">>({ proxy: null, usedBy: [] })),
  http.get(`${API}/secrets/status`, () =>
    json<Res<"/api/v1/secrets/status", "get">>({
      store: "os_key_store",
      protectionNote: null,
      readable: true,
      unreadableSecrets: 0,
      migration: "not_needed",
      migrationMessage: null,
    }),
  ),
];
