/** Thin fetch wrapper for /api/v1: CSRF header, If-Match, RFC 9457 problems → ApiError. */
import { noteDataEpoch, noteRestoreInProgress } from "./dataEpoch";
import type { components } from "./schema";

export type Schemas = components["schemas"];

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
  readonly errors: FieldError[];
  /** The full problem document, including extension members (e.g. `current` on conflicts). */
  readonly problem: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    title: string,
    detail?: string,
    errors: FieldError[] = [],
    problem: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
    this.problem = problem;
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = detail;
    this.errors = errors;
  }

  /** Message for a form field, matching JSON-pointer fields like `/recurrence/end/untilDate`. */
  fieldMessage(field: string): string | undefined {
    const pointer = field.startsWith("/") ? field : `/${field}`;
    return this.errors.find((e) => e.field === pointer || e.field.startsWith(`${pointer}/`))?.message;
  }
}

export const API_BASE = "/api/v1";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Sent as `If-Match: "<version>"` for optimistic concurrency. */
  version?: number;
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
  /** Let the request outlive the page (pagehide flush); body must stay small. */
  keepalive?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (MUTATING.has(method)) {
    const csrf = readCookie("uh_csrf");
    if (csrf) headers["X-CSRF-Token"] = decodeURIComponent(csrf);
  }
  if (options.version !== undefined) headers["If-Match"] = `"${options.version}"`;

  let url = `${API_BASE}${path}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      keepalive: options.keepalive,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Can't reach the server. Check your connection and retry.");
  }

  noteDataEpoch(response.headers.get("X-Data-Epoch"));
  if (response.status === 204) return undefined as T;
  const isJson = (response.headers.get("content-type") ?? "").includes("json");
  const data: unknown = isJson ? await response.json() : undefined;
  if (!response.ok) {
    const p = (data ?? {}) as Partial<{ code: string; title: string; detail: string; errors: FieldError[] }>;
    if (response.status === 423 && p.code === "restore_in_progress") {
      noteRestoreInProgress((data as { jobId?: unknown }).jobId);
    }
    throw new ApiError(
      response.status,
      p.code ?? "http_error",
      p.title ?? response.statusText ?? "Request failed",
      p.detail,
      p.errors ?? [],
      (data ?? {}) as Record<string, unknown>,
    );
  }
  return data as T;
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}
