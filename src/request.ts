import { ApiError } from "./api-error.js";

export const REQUEST_ID_HEADER = "X-Request-Id";
export const DEFAULT_LOGIN_PATH = "/auth/login";

let configuredLoginPath = DEFAULT_LOGIN_PATH;

/**
 * Where a logged-out visitor is sent when a guard or the 401 handler has no `loginPath` of its own. Call it once at start
 * (main.tsx) to send visitors to the app's own entrance page (for example "/enter", which then links to "/auth/login")
 * instead of straight to the identity provider. Default "/auth/login".
 */
export function setLoginPath(path: string): void {
  configuredLoginPath = path;
}

/** The path set by `setLoginPath`, "/auth/login" until then. */
export function getLoginPath(): string {
  return configuredLoginPath;
}

/** UUID v4 for `X-Request-Id`. Uses crypto.randomUUID, with a getRandomValues fallback for insecure contexts. */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Path plus search of the current page, e.g. "/items?tab=2". "/" when there is no window. */
export function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

export function loginUrl(next: string, loginPath: string = configuredLoginPath): string {
  return `${loginPath}?next=${encodeURIComponent(next)}`;
}

export type RedirectFn = (url: string) => void;

export const defaultRedirect: RedirectFn = (url) => {
  window.location.replace(url);
};

/** Sends the browser to the login page. Does nothing when already on an `/auth/` page or on the login page itself (no redirect loops). */
export function redirectToLogin(opts: { redirect?: RedirectFn; loginPath?: string; next?: string } = {}): void {
  const loginPath = opts.loginPath ?? configuredLoginPath;
  const next = opts.next ?? currentPath();
  if (next.startsWith("/auth/") || next === loginPath || next.startsWith(`${loginPath}?`)) return;
  (opts.redirect ?? defaultRedirect)(loginUrl(next, loginPath));
}

export interface FetchDefaults {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  requestId?: () => string;
}

/** Default base URL: the page origin (needed so relative URLs work outside a real browser, e.g. jsdom). */
export function defaultBaseUrl(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** Applies the playground request defaults (credentials, X-Request-Id) to a Request. Caller-set request ids win. */
export function withDefaults(input: Request, requestId: () => string = newRequestId): Request {
  if (!input.headers.has(REQUEST_ID_HEADER)) input.headers.set(REQUEST_ID_HEADER, requestId());
  return input;
}

/** Turns a non-2xx response into a thrown ApiError. */
export async function throwIfNotOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  throw await ApiError.fromResponse(res);
}

/**
 * A fetch with the playground request defaults for the package's own calls outside the generated client (the feedback
 * post, the agent status): cookies included, `Accept: application/json`, and an `X-Request-Id` to find the request in the
 * logs. Returns the response as is; pass it to `throwIfNotOk` for an `ApiError`.
 */
export function platformFetch(url: string, init: RequestInit = {}, opts: { fetch?: typeof globalThis.fetch; requestId?: () => string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has(REQUEST_ID_HEADER)) headers.set(REQUEST_ID_HEADER, (opts.requestId ?? newRequestId)());
  return (opts.fetch ?? globalThis.fetch)(url, { ...init, headers, credentials: "include" });
}
