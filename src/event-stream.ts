import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api-error.js";
import { createSseParser, type SseMessage } from "./sse.js";
import { REQUEST_ID_HEADER, newRequestId, redirectToLogin, type RedirectFn } from "./request.js";
import { parseData } from "./internal.js";

/** Map of event name to parsed `data` payload. */
export type EventMap = object;

export interface EventMeta<K extends string = string> {
  event: K;
  id?: string;
}

/** One optional handler per event name. `data` is parsed JSON, or the raw string when it is not JSON. */
export type EventHandlers<E extends EventMap> = {
  [K in keyof E & string]?: (data: E[K], meta: EventMeta<K>) => void;
};

export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";

export interface BackoffOptions {
  /** First retry delay in ms. Default 500. */
  baseMs?: number;
  /** Delay cap in ms. Default 30000. */
  maxMs?: number;
  /** Max consecutive failed attempts before giving up. Default Infinity. */
  maxRetries?: number;
  /** Randomness source in [0,1). Injectable for tests. */
  random?: () => number;
}

/** How long a stream must have been open before its end counts as healthy and resets the backoff. */
const HEALTHY_MS = 10_000;

/** Exponential backoff with "equal jitter": half fixed, half random, capped. attempt starts at 0. */
export function backoffDelay(attempt: number, o: BackoffOptions = {}): number {
  const base = o.baseMs ?? 500;
  const max = o.maxMs ?? 30_000;
  const exp = Math.min(max, base * 2 ** attempt);
  const r = (o.random ?? Math.random)();
  return Math.round(exp / 2 + (exp / 2) * r);
}

export interface EventStreamOptions {
  /** HTTP method. Default "GET" (auto-connects). Use "POST" for an endpoint that answers a request body with a stream, together with `send(body)`. */
  method?: "GET" | "POST";
  /** Connect on mount / url change. Default: true for GET, false for POST. */
  autoConnect?: boolean;
  /** Reconnect after a dropped stream. Default: true for auto-connected GET streams, false for `send()` (never replay a POST by accident). */
  reconnect?: boolean | BackoffOptions;
  /** Stop (no reconnect) after one of these events arrives. Default `["done"]`. */
  closeOn?: string[];
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  onOpen?: () => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  /** Called with the login URL on a 401. Default `window.location.replace`. */
  redirect?: RedirectFn;
  requestId?: () => string;
  /** Which failing HTTP statuses are retried with backoff. Default: 5xx, 408 and 429. */
  retryOn?: (status: number) => boolean;
  /** Test hook: replaces the reconnect timer. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Clock for the health check below (test hook). */
  now?: () => number;
}

export interface EventStreamControls {
  status: StreamStatus;
  error: Error | null;
  /** Opens a POST stream with a JSON body and resolves when it ends (or is aborted). Aborts any stream already open. */
  send: (body?: unknown) => Promise<void>;
  /** Aborts the current stream and stops reconnecting. */
  close: () => void;
  /** (Re)opens the auto-connect stream, e.g. after `close()`. */
  connect: () => void;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}


function retryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

interface RunConfig {
  url: string;
  method: "GET" | "POST";
  body: unknown;
  signal: AbortSignal;
  reconnect: false | BackoffOptions;
  closeOn: string[];
  options: EventStreamOptions;
  onMessage: (m: SseMessage) => void;
  setStatus: (s: StreamStatus) => void;
  setError: (e: Error | null) => void;
}

/**
 * The transport: fetch + ReadableStream + a hand-written SSE parser, not EventSource.
 * EventSource cannot send a POST body or custom headers, and some endpoints are a POST with an SSE response.
 */
export async function runEventStream(cfg: RunConfig): Promise<void> {
  const { signal, options } = cfg;
  const doFetch = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const makeId = options.requestId ?? newRequestId;
  const url = new URL(cfg.url, typeof window === "undefined" ? undefined : window.location.href).toString();
  let attempt = 0;
  let lastId: string | undefined;
  let serverRetry: number | undefined;

  const fail = (e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    cfg.setError(err);
    options.onError?.(err);
    return err;
  };

  while (!signal.aborted) {
    cfg.setStatus(attempt === 0 && lastId === undefined ? "connecting" : "reconnecting");
    let finished = false;
    let openedAt: number | null = null;
    try {
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        [REQUEST_ID_HEADER]: makeId(),
        ...options.headers,
      };
      if (cfg.body !== undefined) headers["Content-Type"] = "application/json";
      if (lastId !== undefined) headers["Last-Event-ID"] = lastId;
      const init: RequestInit = { method: cfg.method, headers, credentials: "include", signal };
      if (cfg.body !== undefined) init.body = JSON.stringify(cfg.body);
      const res = await doFetch(url, init);

      if (!res.ok) {
        const apiErr = await ApiError.fromResponse(res);
        if (res.status === 401) {
          const r: Parameters<typeof redirectToLogin>[0] = {};
          if (options.redirect) r.redirect = options.redirect;
          redirectToLogin(r);
        }
        fail(apiErr);
        if (!(options.retryOn ?? retryable)(res.status)) {
          cfg.setStatus("error");
          return;
        }
      } else if (!res.body) {
        fail(new Error("Event stream response has no body"));
      } else {
        cfg.setError(null);
        cfg.setStatus("open");
        openedAt = now();
        options.onOpen?.();
        const parser = createSseParser({
          onMessage: (m) => {
            if (m.id !== undefined) lastId = m.id;
            attempt = 0;
            cfg.onMessage(m);
            if (cfg.closeOn.includes(m.event)) finished = true;
          },
          onRetry: (ms) => {
            serverRetry = ms;
          },
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        // Cancel the reader when the signal aborts so a pending read() ends even if the body is not tied to the signal.
        const onAbort = () => void reader.cancel().catch(() => undefined);
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.push(decoder.decode(value, { stream: true }));
            if (finished) break;
          }
          parser.push(decoder.decode());
          parser.end();
        } finally {
          signal.removeEventListener("abort", onAbort);
          if (finished || signal.aborted) await reader.cancel().catch(() => undefined);
          else reader.releaseLock();
        }
        if (finished || !cfg.reconnect) {
          cfg.setStatus("closed");
          options.onClose?.();
          return;
        }
      }
    } catch (e) {
      if (signal.aborted) return;
      fail(e);
    }

    if (signal.aborted) return;
    // A connection that stayed open a while was healthy even if it carried only comments (`: live`, `: ping`): the next
    // wait starts from the base again. One that opened and dropped at once keeps backing off.
    if (openedAt !== null && now() - openedAt >= HEALTHY_MS) attempt = 0;
    if (!cfg.reconnect) {
      cfg.setStatus("error");
      return;
    }
    if (attempt >= (cfg.reconnect.maxRetries ?? Infinity)) {
      cfg.setStatus("error");
      return;
    }
    const delay = serverRetry ?? backoffDelay(attempt, cfg.reconnect);
    attempt++;
    cfg.setStatus("reconnecting");
    await sleep(delay, signal);
  }
}

/**
 * SSE over fetch. GET mode connects on mount and reconnects with exponential backoff + jitter, resuming with
 * `Last-Event-ID`. POST mode (`method: "POST"`) streams the response of `send(body)`.
 * Streams are aborted on unmount. Handler identity may change every render without reconnecting.
 */
export function useEventStream<E extends EventMap = Record<string, unknown>>(
  url: string | null | undefined,
  handlers: EventHandlers<E>,
  options: EventStreamOptions = {},
): EventStreamControls {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const handlersRef = useRef(handlers);
  const optionsRef = useRef(options);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    handlersRef.current = handlers;
    optionsRef.current = options;
  });

  const start = useCallback(
    (method: "GET" | "POST", body: unknown): Promise<void> => {
      abortRef.current?.abort();
      if (!url) return Promise.resolve();
      const ctl = new AbortController();
      abortRef.current = ctl;
      const opts = optionsRef.current;
      const rc = opts.reconnect ?? (method === "GET");
      const guard = <T,>(fn: (v: T) => void) => (v: T) => {
        if (!ctl.signal.aborted && mountedRef.current) fn(v);
      };
      return runEventStream({
        url,
        method,
        body,
        signal: ctl.signal,
        reconnect: rc === false ? false : rc === true ? {} : rc,
        closeOn: opts.closeOn ?? ["done"],
        options: opts,
        setStatus: guard(setStatus),
        setError: guard(setError),
        onMessage: guard((m: SseMessage) => {
          const h = handlersRef.current as Record<string, ((d: unknown, meta: EventMeta) => void) | undefined>;
          const meta: EventMeta = { event: m.event };
          if (m.id !== undefined) meta.id = m.id;
          h[m.event]?.(parseData(m.data), meta);
        }),
      });
    },
    [url],
  );

  const connect = useCallback(() => {
    void start("GET", undefined);
  }, [start]);

  const send = useCallback((body?: unknown) => start(optionsRef.current.method ?? "POST", body), [start]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus((s) => (s === "idle" ? s : "closed"));
  }, []);

  const auto = options.autoConnect ?? (options.method ?? "GET") === "GET";
  useEffect(() => {
    mountedRef.current = true;
    if (auto && url) void start("GET", undefined);
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [auto, url, start]);

  return { status, error, send, close, connect };
}
