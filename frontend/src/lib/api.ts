/**
 * A small, typed wrapper around `fetch` for the Django API.
 *
 * How authentication works (see docs/api.md, "Authentication model"):
 *
 *  - The API uses Django's session cookie (`sessionid`, HttpOnly). JavaScript
 *    never sees it; we only have to send `credentials: "include"` so the
 *    browser attaches it, including in local dev where the API is on another
 *    port (localhost:3000 -> localhost:8000 is "same-site", so cookies flow).
 *
 *  - Django protects every POST/PATCH/PUT/DELETE with a CSRF token. The token
 *    lives in the `csrftoken` cookie (readable by JS). We copy it into the
 *    `X-CSRFToken` header. Django ROTATES the token at login, so we read the
 *    cookie fresh on every request instead of caching it in a variable.
 *
 *  - The cookie is created by `GET /api/auth/csrf/`. `ensureCsrf()` calls it
 *    once, the first time we need a token and the cookie isn't there yet.
 */

/** Where the API lives. "" means "same origin as this page" (production). */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

/** Turn an API path ("/api/…") into a URL the browser can fetch. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Every API error has this shape: {"error", "code", "fields"?}. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  /** Seconds to wait before retrying (503 model_starting sends `retry_after`). */
  readonly retryAfter: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string> = {},
    retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** A message that is safe to show to the user for any thrown value. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}

/* ------------------------------------------------------------------ CSRF */

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

let csrfRequest: Promise<void> | null = null;

/**
 * Make sure the `csrftoken` cookie exists. Concurrent callers share one
 * request. `force` asks for a new cookie (after a `csrf_failed` error).
 */
export function ensureCsrf(force = false): Promise<void> {
  if (!force && readCookie("csrftoken")) return Promise.resolve();
  if (!csrfRequest || force) {
    csrfRequest = fetch(apiUrl("/api/auth/csrf/"), { credentials: "include" })
      .then(() => undefined)
      .finally(() => {
        csrfRequest = null;
      });
  }
  return csrfRequest;
}

/** Headers for a state-changing request: the CSRF token, read right now. */
export async function csrfHeaders(): Promise<Record<string, string>> {
  await ensureCsrf();
  const token = readCookie("csrftoken");
  return token ? { "X-CSRFToken": token } : {};
}

/* ------------------------------------------------------------ 401 hook */

type Handler = () => void;
let onUnauthorized: Handler | null = null;

/**
 * The signed-in part of the app registers a handler here so that any request
 * answered with `401 not_authenticated` (e.g. the session expired) sends the
 * user back to the login page.
 */
export function setUnauthorizedHandler(handler: Handler | null): void {
  onUnauthorized = handler;
}

/* ------------------------------------------------------------- errors */

function normaliseFields(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.map(String).join(" ");
  }
  return out;
}

/** Build an ApiError from a non-2xx response, whatever its body looks like. */
export async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (a proxy error page, for example). Fall through to defaults.
  }
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const message =
    typeof obj.error === "string"
      ? obj.error
      : typeof obj.detail === "string"
        ? obj.detail
        : defaultMessage(res.status);
  const code = typeof obj.code === "string" ? obj.code : `http_${res.status}`;
  const header = Number(res.headers.get("Retry-After"));
  const retryAfter = typeof obj.retry_after === "number" ? obj.retry_after : Number.isFinite(header) && header > 0 ? header : null;
  return new ApiError(res.status, code, message, normaliseFields(obj.fields), retryAfter);
}

function defaultMessage(status: number): string {
  if (status === 401) return "Please sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "Not found.";
  if (status === 413) return "That file is too large.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return "The server had a problem. Please try again.";
  return "Something went wrong. Please try again.";
}

export const networkError = () =>
  new ApiError(0, "network_error", "Can't reach the server. Check your connection and try again.");

/* ------------------------------------------------------------ request */

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * `fetch` + credentials + CSRF + JSON + error parsing. Low level: most code
 * uses the `api.get/post/patch/del` shortcuts below. Returns the raw Response
 * (used by the SSE client, which needs the body stream).
 */
export async function rawRequest(
  method: Method,
  path: string,
  body?: unknown,
  options: RequestOptions & { accept?: string } = {},
  retried = false,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: options.accept ?? "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") Object.assign(headers, await csrfHeaders());

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw networkError();
  }

  if (res.ok) return res;

  const error = await toApiError(res);
  // A stale or missing CSRF cookie: fetch a fresh one and try once more.
  if (error.status === 403 && error.code === "csrf_failed" && !retried) {
    await ensureCsrf(true);
    return rawRequest(method, path, body, options, true);
  }
  if (error.status === 401) onUnauthorized?.();
  throw error;
}

async function request<T>(method: Method, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  const res = await rawRequest(method, path, body, options);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body: unknown = {}, options?: RequestOptions) => request<T>("POST", path, body, options),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) => request<T>("PATCH", path, body, options),
  del: <T = void>(path: string, body?: unknown, options?: RequestOptions) => request<T>("DELETE", path, body, options),
};
