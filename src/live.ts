import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { matchesPaths, useLiveQueries } from "./live-queries.js";
import type { LiveEvent, LiveQueries, LiveQueriesOptions, QueryMatcher } from "./live-queries.js";

/** The resource a generated-hook query belongs to: the first path segment after `/api/` (`/api/widgets/{id}` is `widgets`). */
export function resourceOfPath(path: string): string | null {
  const m = /^\/api\/([^/{}]+)/.exec(path);
  return m?.[1] ?? null;
}

export interface LiveOptions extends Pick<LiveQueriesOptions, "onEvent" | "debounceMs" | "jitterMs" | "random" | "reconnect" | "transport"> {
  /** The app's event stream. Default `/api/live`. */
  url?: string;
  /**
   * Resources whose API paths do not follow the convention, as resource name to path prefixes
   * (`{ beads: ["/api/work/"] }`). A listed resource uses its prefixes instead of the convention.
   */
  resources?: Record<string, readonly string[]>;
  /** Which queries the full refresh (after a reconnect or a tab show, or an event naming no resource) covers. Default `["/api/"]`. */
  paths?: readonly string[];
  /**
   * Opt in to polling: while the stream is not live (reconnecting or degraded) and the tab is visible, refresh the
   * `paths` queries every this many ms. Off by default; a screen that wants it says so.
   */
  pollWhenNotLiveMs?: number;
  /** Turn the stream on even in a test browser (`navigator.webdriver`) or with `?live=0`: for the one dedicated e2e. Also `?live=1`. */
  force?: boolean;
  /** Turn it off without unmounting. Default true. */
  enabled?: boolean;
}

function searchParam(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

/** Off in a test browser, so `networkidle` settles, unless forced; off with `?live=0`. */
function streamAllowed(force: boolean | undefined): boolean {
  if (force === true || searchParam("live") === "1") return true;
  if (searchParam("live") === "0") return false;
  return !(typeof navigator !== "undefined" && navigator.webdriver === true);
}

/**
 * Keeps every generated-hook query current from the app's `/api/live` stream. Events say which resource changed
 * (`data.resource`); the queries under it refetch (the resource is the first path segment after `/api/`, or the
 * prefixes you map it to). An event naming no resource, a reconnect and a tab show refresh everything under `paths`,
 * after a random 0 to 2 s delay. Visible tab only. `status`: live, reconnecting, degraded (the server's source is
 * down) or off (disabled, hidden, or a test browser). There is no polling unless you ask for it.
 */
export function useLive(options: LiveOptions = {}): LiveQueries {
  const { url = "/api/live", resources = {}, paths = ["/api/"], pollWhenNotLiveMs, force, enabled = true } = options;
  const queryClient = useQueryClient();
  const allowed = enabled && streamAllowed(force);

  const invalidateFor = (events: readonly LiveEvent[]): QueryMatcher | null => {
    const names = new Set<string>();
    for (const e of events) {
      const r = (e.data as { resource?: unknown } | null)?.resource;
      if (typeof r !== "string" || r === "*" || r === "") return null;
      names.add(r);
    }
    const inScope = matchesPaths(paths);
    return (q) => {
      if (!inScope(q)) return false;
      const path = q.queryKey[1];
      if (typeof path !== "string") return false;
      const own = resourceOfPath(path);
      for (const n of names) {
        const prefixes = resources[n];
        if (prefixes ? prefixes.some((p) => path.startsWith(p)) : own === n) return true;
      }
      return false;
    };
  };

  const live = useLiveQueries({
    url: allowed ? url : null,
    invalidate: paths,
    invalidateFor,
    jitterMs: options.jitterMs ?? 2000,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.random ? { random: options.random } : {}),
    ...(options.reconnect ? { reconnect: options.reconnect } : {}),
    ...(options.transport ? { transport: options.transport } : {}),
  });

  const polling = pollWhenNotLiveMs !== undefined && allowed && !live.paused && live.status !== "live";
  useEffect(() => {
    if (!polling || pollWhenNotLiveMs === undefined) return;
    const t = setInterval(() => void queryClient.invalidateQueries({ predicate: matchesPaths(paths) }), pollWhenNotLiveMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paths is a stable literal in practice
  }, [polling, pollWhenNotLiveMs, queryClient]);

  return live;
}
