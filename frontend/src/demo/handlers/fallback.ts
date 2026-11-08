/** 024: anything no other handler answers (contracts/demo-mode.md §4). Must be registered last. */
import { http, type HttpHandler } from "msw";
import { API, notFound } from "../http";
import { demoUnavailable } from "../unavailable";

export const handlers: HttpHandler[] = [
  // The PDF reader loads a stamp library from a CDN and a web font from Google; the demo talks to
  // no other site (SC-003), so both are answered here (the reader falls back to built-in fonts).
  http.get("https://cdn.jsdelivr.net/npm/@embedpdf/*", () => new Response(null, { status: 404 })),
  http.get("https://fonts.googleapis.com/*", () => new Response("", { headers: { "Content-Type": "text/css" } })),
  http.get("https://fonts.gstatic.com/*", () => new Response(null, { status: 404 })),
  http.all(`${API}/*`, ({ request }) => {
    if (import.meta.env.DEV) console.warn("[demo] unhandled", request.method, new URL(request.url).pathname);
    return request.method === "GET" ? notFound() : demoUnavailable("This action");
  }),
];
