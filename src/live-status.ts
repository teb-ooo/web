import { useSyncExternalStore } from "react";
import type { LiveStatus } from "./live-queries.js";

const statuses = new Map<string, LiveStatus>();
const listeners = new Set<() => void>();
let current: LiveStatus = "off";

function aggregate(): LiveStatus {
  const all = [...statuses.values()];
  for (const s of ["live", "degraded", "reconnecting"] as const) if (all.includes(s)) return s;
  return "off";
}

function changed(): void {
  const next = aggregate();
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}

/** `useLiveQueries` and `useLive` report here; nothing else should. One entry per mounted stream. */
export function publishLiveStatus(id: string, status: LiveStatus): void {
  statuses.set(id, status);
  changed();
}

export function clearLiveStatus(id: string): void {
  statuses.delete(id);
  changed();
}

/**
 * The live-data status of the screen for the platform bar's dot: `live` while any stream is live, else `degraded`,
 * else `reconnecting`, else `off` (also when no screen has a stream).
 */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => "off",
  );
}
