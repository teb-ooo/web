import { useEffect, useState } from "react";
import { useUser } from "./auth.js";

export type AgentStatus = "working" | "idle" | "offline" | "logged_out";

export interface AgentState {
  agent: string;
  status: AgentStatus;
  /** RFC 3339 time the agent entered this status, or "". */
  since: string;
  /** A line about what it is doing, or "". */
  summary: string;
}

export interface AgentStatusOptions {
  /** The platform's route on the app's own origin. Default `/_playground/agent`. */
  endpoint?: string;
  /** Turn it off without unmounting. Default true. */
  enabled?: boolean;
  /** Milliseconds between asks while the tab is visible. Default 15000. */
  intervalMs?: number;
  /** Also in a test browser (`navigator.webdriver`), which is skipped by default so `networkidle` settles. */
  force?: boolean;
  /** Test hook. */
  fetch?: typeof globalThis.fetch;
}

const STATUSES: readonly string[] = ["working", "idle", "offline", "logged_out"];

function parse(body: unknown): AgentState | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.status !== "string" || !STATUSES.includes(b.status)) return null;
  return {
    agent: typeof b.agent === "string" ? b.agent : "",
    status: b.status as AgentStatus,
    since: typeof b.since === "string" ? b.since : "",
    summary: typeof b.summary === "string" ? b.summary : "",
  };
}

/**
 * The status of the app's agent for the platform bar's dot, polled from the platform's `/_playground/agent` while the
 * tab is visible. Only the superadmin or the app's owner can read it; for anyone else, in a test browser, or when the
 * route is missing or fails, it is `null` and the bar draws no dot.
 */
export function useAgentStatus(options: AgentStatusOptions = {}): AgentState | null {
  const { endpoint = "/_playground/agent", enabled = true, intervalMs = 15_000 } = options;
  const { user } = useUser();
  const person = user !== null && (user.is_admin || user.is_owner === true);
  const quiet = typeof navigator !== "undefined" && navigator.webdriver === true && options.force !== true;
  const on = enabled && person && !quiet;
  const [state, setState] = useState<AgentState | null>(null);

  useEffect(() => {
    if (!on) {
      setState(null);
      return;
    }
    const doFetch = options.fetch ?? globalThis.fetch;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return schedule();
      controller = new AbortController();
      try {
        const res = await doFetch(endpoint, { credentials: "include", headers: { Accept: "application/json" }, signal: controller.signal });
        if (!alive) return;
        setState(res.ok ? parse(await res.json()) : null);
      } catch {
        if (alive) setState(null);
      }
      schedule();
    };
    const schedule = () => {
      if (alive) timer = setTimeout(() => void tick(), intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options.fetch is a test hook
  }, [on, endpoint, intervalMs]);

  return on ? state : null;
}
