import { useEffect, useState } from "react";
import { useUser } from "./auth.js";

export type AgentStatus = "working" | "idle" | "offline" | "logged_out";

/** What the agent is doing right now, as the platform describes it (a label from a fixed list and a safe target). */
export interface AgentAction {
  /** For example "Editing", "Running tests", "Searching the code", "Waiting for a reply". */
  label: string;
  /** A repo-relative path, an agent type or "": never raw input. */
  target: string;
  /** RFC 3339 time the action began. */
  since: string;
}

export interface AgentState {
  agent: string;
  status: AgentStatus;
  /** RFC 3339 time the agent entered this status, or "". */
  since: string;
  /** A line about what it is doing, or "". */
  summary: string;
  /** The current action, or null (an older platform, or nothing running). */
  action: AgentAction | null;
  /** RFC 3339 time the current turn began, or "" outside a turn. */
  turnStartedAt: string;
  /** The server's clock when it answered, for a timer without clock skew. Milliseconds since the epoch, or 0 when unknown. */
  serverTime: number;
  /** When this answer arrived here (`Date.now()`), so a timer can keep ticking between polls. */
  receivedAt: number;
}

export interface AgentStatusOptions {
  /** The platform's route on the app's own origin. Default `/_playground/agent`. */
  endpoint?: string;
  /** Turn it off without unmounting. Default true. */
  enabled?: boolean;
  /** Milliseconds between asks while the tab is visible. Default 15000. */
  intervalMs?: number;
  /** Ask this often instead while true (a popover that shows the live details is open). Default 3000. */
  fastMs?: number;
  /** Poll at `fastMs`. */
  fast?: boolean;
  /** Also in a test browser (`navigator.webdriver`), which is skipped by default so `networkidle` settles. */
  force?: boolean;
  /** Test hook. */
  fetch?: typeof globalThis.fetch;
}

const STATUSES: readonly string[] = ["working", "idle", "offline", "logged_out"];

function parseAction(raw: unknown): AgentAction | null {
  if (raw === null || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.label !== "string" || a.label === "") return null;
  return { label: a.label, target: typeof a.target === "string" ? a.target : "", since: typeof a.since === "string" ? a.since : "" };
}

function parse(body: unknown): AgentState | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.status !== "string" || !STATUSES.includes(b.status)) return null;
  return {
    agent: typeof b.agent === "string" ? b.agent : "",
    status: b.status as AgentStatus,
    since: typeof b.since === "string" ? b.since : "",
    summary: typeof b.summary === "string" ? b.summary : "",
    action: parseAction(b.action),
    turnStartedAt: typeof b.turn_started_at === "string" ? b.turn_started_at : "",
    serverTime: typeof b.server_time === "string" && !Number.isNaN(Date.parse(b.server_time)) ? Date.parse(b.server_time) : 0,
    receivedAt: Date.now(),
  };
}

/**
 * The status of the app's agent for the platform bar's dot, polled from the platform's `/_playground/agent` while the
 * tab is visible. Only the superadmin or the app's owner can read it; for anyone else, in a test browser, or when the
 * route is missing or fails, it is `null` and the bar draws no dot.
 */
export function useAgentStatus(options: AgentStatusOptions = {}): AgentState | null {
  const { endpoint = "/_playground/agent", enabled = true, fastMs = 3_000 } = options;
  const intervalMs = options.fast ? fastMs : (options.intervalMs ?? 15_000);
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

/** How long the current turn has run, in milliseconds, from an answer of `useAgentStatus`; null outside a turn. Pass `Date.now()` as `now`. */
export function turnElapsedMs(state: Pick<AgentState, "turnStartedAt" | "serverTime" | "receivedAt"> | null, now: number): number | null {
  if (!state || state.turnStartedAt === "") return null;
  const started = Date.parse(state.turnStartedAt);
  if (Number.isNaN(started)) return null;
  // The server's clock at the answer plus what has passed here since it arrived: no browser clock skew.
  const serverNow = state.serverTime > 0 ? state.serverTime + (now - state.receivedAt) : now;
  return Math.max(0, serverNow - started);
}

/** "4m 12s", "38s", "1h 05m". */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
