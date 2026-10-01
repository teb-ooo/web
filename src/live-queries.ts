import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";
import { runEventStream } from "./event-stream.js";
import type { BackoffOptions, EventMeta, EventStreamOptions, StreamStatus } from "./event-stream.js";

/** Decides which cached queries an event makes stale. */
export type QueryMatcher = (query: Query) => boolean;

/**
 * Matches the queries of the generated hooks whose OpenAPI path starts with one of `prefixes`. The keys that
 * openapi-react-query builds are `[method, path, init]`, and `path` is the path template (`/api/work/issues/{id}`),
 * so `matchesPaths(["/api/work/"])` covers every list and detail under it.
 */
export function matchesPaths(prefixes: readonly string[]): QueryMatcher {
  return (query) => {
    const path: unknown = query.queryKey[1];
    return typeof path === "string" && prefixes.some((p) => path.startsWith(p));
  };
}

/** One event the stream delivered: `data` is parsed JSON, or the raw string. */
export interface LiveEvent {
  data: unknown;
  meta: EventMeta;
}

/**
 * `live`: the stream is open. `reconnecting`: trying (a server that answers with an error is retried with backoff).
 * `degraded`: open, but the server said a source it relays is down (a `degraded` event), so changes may be missed until
 * the next change event; a screen may poll while it lasts if it chooses to. `off`: disabled, no url, or the tab is hidden.
 */
export type LiveStatus = "live" | "reconnecting" | "degraded" | "off";

export interface LiveQueriesOptions {
  /** The SSE endpoint (same origin, the session cookie goes along). Null or undefined keeps it off. */
  url: string | null | undefined;
  /** Which queries an event makes stale: path prefixes, or a predicate over the query. Also used for the full refresh. */
  invalidate: readonly string[] | QueryMatcher;
  /**
   * Narrows what a burst of events makes stale: given the events of one debounce window, return the matcher for them,
   * or null to refresh everything `invalidate` names. The full refresh after a reconnect or a tab show always uses `invalidate`.
   */
  invalidateFor?: (events: readonly LiveEvent[]) => QueryMatcher | null;
  /** Called for every event; return `false` to ignore that event. `data` is parsed JSON, or the raw string. */
  onEvent?: (data: unknown, meta: EventMeta) => boolean | void;
  /** Turn the stream off without unmounting. Default true. */
  enabled?: boolean;
  /** Events within this window become one refetch. Default 300. */
  debounceMs?: number;
  /** Reconnect backoff. Default: 500ms doubling to 30s, with jitter. */
  reconnect?: BackoffOptions;
  /**
   * Random delay in ms, up to this, before the full refresh after a reconnect or a tab show, so a deploy does not
   * make every open tab refetch in the same instant. Default 0.
   */
  jitterMs?: number;
  /** Randomness source in [0,1), for tests. */
  random?: () => number;
  /** Transport overrides (`fetch`, `sleep`), for tests. */
  transport?: Pick<EventStreamOptions, "fetch" | "sleep">;
}

export interface LiveQueries {
  /** See LiveStatus. A server that answers with an error (503, 404) is `reconnecting`, retried with backoff up to 30s; only a 401 stops (it sends the browser to sign in). */
  status: LiveStatus;
  /** The tab is hidden, so the stream is closed until it is shown again. */
  paused: boolean;
}

function parseData(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function subscribeVisibility(notify: () => void): () => void {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}
const isVisible = () => document.visibilityState !== "hidden";

function liveStatus(s: StreamStatus): LiveStatus {
  if (s === "open") return "live";
  if (s === "connecting" || s === "reconnecting") return "reconnecting";
  return "off";
}

/**
 * Keeps the generated query hooks current from a server stream: when events arrive, the matching cached queries
 * are invalidated (one refetch per `debounceMs` window, however many events). The stream is open only while the tab
 * is visible. After a dropped connection or a hidden tab events may have been missed, so the next time the stream
 * opens everything `invalidate` names is invalidated once (after a random delay of up to `jitterMs`), without waiting
 * for an event. Reconnects send `Last-Event-ID`. It never patches the cache: it only says what is stale.
 */
export function useLiveQueries(options: LiveQueriesOptions): LiveQueries {
  const { url, enabled = true, debounceMs = 300 } = options;
  const queryClient = useQueryClient();
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  const [streamStatus, setStreamStatus] = useState<LiveStatus>("off");
  const [degraded, setDegraded] = useState(false);
  const optionsRef = useRef(options);
  const openedBefore = useRef(false);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!enabled || !url || !visible) {
      setStreamStatus("off");
      setDegraded(false);
      return;
    }
    const ctl = new AbortController();
    const pending: LiveEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fullTimer: ReturnType<typeof setTimeout> | undefined;
    const matcherOf = (inv: readonly string[] | QueryMatcher): QueryMatcher => (typeof inv === "function" ? inv : matchesPaths(inv));
    const flushEvents = () => {
      timer = undefined;
      const events = pending.splice(0);
      const o = optionsRef.current;
      const narrowed = o.invalidateFor?.(events) ?? null;
      void queryClient.invalidateQueries({ predicate: narrowed ?? matcherOf(o.invalidate) });
    };
    const flushAll = () => {
      fullTimer = undefined;
      void queryClient.invalidateQueries({ predicate: matcherOf(optionsRef.current.invalidate) });
    };
    const opts: EventStreamOptions = {
      // A live view should outlast a server that is not ready (503, or a route that does not exist yet): keep trying.
      retryOn: (status) => status !== 401,
      onOpen: () => {
        // Anything that happened while there was no stream is unknown: refresh what matches, once, spread over a moment.
        if (openedBefore.current && fullTimer === undefined) {
          const o = optionsRef.current;
          fullTimer = setTimeout(flushAll, Math.round((o.random ?? Math.random)() * (o.jitterMs ?? 0)));
        }
        openedBefore.current = true;
      },
      ...optionsRef.current.transport,
    };
    void runEventStream({
      url,
      method: "GET",
      body: undefined,
      signal: ctl.signal,
      reconnect: optionsRef.current.reconnect ?? {},
      closeOn: [],
      options: opts,
      setStatus: (s) => {
        if (ctl.signal.aborted) return;
        setStreamStatus(liveStatus(s));
        if (s !== "open") setDegraded(false);
      },
      setError: () => undefined,
      onMessage: (m) => {
        if (ctl.signal.aborted) return;
        const meta: EventMeta = { event: m.event };
        if (m.id !== undefined) meta.id = m.id;
        const data = parseData(m.data);
        if (m.event === "degraded") {
          setDegraded(true);
          return;
        }
        setDegraded(false);
        if (optionsRef.current.onEvent?.(data, meta) === false) return;
        pending.push({ data, meta });
        timer ??= setTimeout(flushEvents, debounceMs);
      },
    });
    return () => {
      ctl.abort();
      if (timer !== undefined) clearTimeout(timer);
      if (fullTimer !== undefined) clearTimeout(fullTimer);
    };
  }, [url, enabled, visible, debounceMs, queryClient]);

  return { status: streamStatus === "live" && degraded ? "degraded" : streamStatus, paused: !visible };
}
