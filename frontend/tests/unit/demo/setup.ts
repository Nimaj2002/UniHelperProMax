/**
 * 024: run the demo's handlers under msw/node and call them through the real `apiFetch`, so the
 * tests exercise the production client against the in-browser API.
 */
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { apiFetch, type ApiOptions } from "@/lib/api";
import { handlers } from "@/demo/handlers";
import { createSeed } from "@/demo/seed";
import { resetStore } from "@/demo/store";

vi.mock("sonner", () => ({ toast: vi.fn() }));

/** Wednesday 4 Nov 2026, 12:00 in Istanbul. */
export const FIXED_NOW = new Date("2026-11-04T09:00:00Z");
export const TZ = "Europe/Istanbul";

export const server = setupServer(...handlers);

export function startDemoServer(now = FIXED_NOW) {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
    const mswFetch = globalThis.fetch; // patched by listen()
    // apiFetch uses same-origin relative URLs; Node's fetch needs them absolute
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      mswFetch(typeof input === "string" && input.startsWith("/") ? new URL(input, location.href).href : input, init),
    );
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    resetStore(createSeed(now, TZ));
  });
  afterEach(() => {
    vi.useRealTimers();
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
    vi.unstubAllGlobals();
  });
}

export const api = <T>(path: string, options?: ApiOptions) => apiFetch<T>(path, options);

/** Raw response for non-JSON endpoints (files, streams). */
export const raw = (path: string, init?: RequestInit) => fetch(`/api/v1${path}`, init);
