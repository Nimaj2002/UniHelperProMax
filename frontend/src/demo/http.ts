/**
 * 024: response helpers for the demo's in-browser API (contracts/demo-mode.md). Shapes match the
 * real backend: JSON bodies, RFC 9457 problems with `code`, `If-Match` version checks.
 */
import { HttpResponse } from "msw";
import type { paths } from "@/lib/api/schema";

export const API = "/api/v1";

type Method = "get" | "post" | "put" | "patch" | "delete";
type JsonOf<R> = R extends { content: { "application/json": infer B } } ? B : never;
type Ok<Rs> = JsonOf<Rs[Extract<keyof Rs, 200 | 201>]>;

/** The JSON body the real API returns for `method path` (typed from schema.d.ts, research R12). */
export type Res<P extends keyof paths, M extends Method> = paths[P][M] extends { responses: infer Rs } ? Ok<Rs> : never;
/** The JSON request body of `method path`. */
export type Body<P extends keyof paths, M extends Method> = paths[P][M] extends {
  requestBody?: { content: { "application/json": infer B } };
}
  ? B
  : never;

export function json<T>(body: T, status = 200): Response {
  return HttpResponse.json(body as never, { status });
}

export function noContent(): Response {
  return new HttpResponse(null, { status: 204 });
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export function problem(
  status: number,
  code: string,
  title: string,
  detail?: string,
  errors?: FieldError[],
  extra?: Record<string, unknown>,
): Response {
  const body = { type: "about:blank", status, code, title, ...(detail ? { detail } : {}), ...(errors ? { errors } : {}), ...extra };
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/problem+json" } });
}

export const notFound = (what = "Resource") => problem(404, "not_found", `${what} not found`);

export function validation(field: string, message: string, code = "invalid"): Response {
  return problem(422, code, message, undefined, [{ field: field.startsWith("/") ? field : `/${field}`, code, message }]);
}

/** The real API's optimistic-concurrency check; returns a problem response or null when fine. */
export function checkIfMatch(request: Request, item: { version: number }): Response | null {
  const raw = request.headers.get("If-Match");
  if (raw === null) return null; // the demo is lenient where the real API would answer 428
  const v = Number(raw.replace(/^W\//, "").replace(/"/g, ""));
  if (v !== item.version) return problem(412, "version_conflict", "This item was changed elsewhere. Reload and try again.");
  return null;
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}
