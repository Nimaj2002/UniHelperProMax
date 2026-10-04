import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

export type Handler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;

export function json(body: unknown, status = 200, contentType = "application/json"): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

export function problem(status: number, code: string, title = code, errors: unknown[] = []): Response {
  return json({ type: `/problems/${code}`, title, status, code, errors }, status, "application/problem+json");
}

/** Route fetch calls through handlers; unmatched calls fail the test loudly. */
export function mockFetch(...handlers: Handler[]) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    calls.push({ url, init });
    for (const h of handlers) {
      const r = await h(url, init);
      if (r) return r;
    }
    throw new Error(`Unhandled fetch ${init.method ?? "GET"} ${url.pathname}${url.search}`);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

export function on(method: string, path: string | RegExp, respond: (url: URL, init: RequestInit) => Response): Handler {
  return (url, init) => {
    const m = (init.method ?? "GET").toUpperCase();
    const matches = typeof path === "string" ? url.pathname === path : path.test(url.pathname);
    return m === method && matches ? respond(url, init) : undefined;
  };
}

export function renderRoutes(routes: RouteObject[], initialPath: string, client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const utils = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, client: qc };
}

export function renderWithProviders(ui: ReactElement, path = "/") {
  return renderRoutes([{ path: "*", element: ui }], path);
}
