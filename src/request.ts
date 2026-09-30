import { ApiError } from "./api-error.js";

export const REQUEST_ID_HEADER = "X-Request-Id";
export const DEFAULT_LOGIN_PATH = "/auth/login";

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

export function loginUrl(next: string, loginPath: string = DEFAULT_LOGIN_PATH): string {
  return `${loginPath}?next=${encodeURIComponent(next)}`;
}

export type RedirectFn = (url: string) => void;

export const defaultRedirect: RedirectFn = (url) => {
  window.location.assign(url);
};

/** Sends the browser to the login page. Does nothing when already on an `/auth/` page (no redirect loops). */
export function redirectToLogin(opts: { redirect?: RedirectFn; loginPath?: string; next?: string } = {}): void {
  const loginPath = opts.loginPath ?? DEFAULT_LOGIN_PATH;
  const next = opts.next ?? currentPath();
  if (next.startsWith("/auth/")) return;
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
