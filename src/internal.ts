// Small helpers shared inside the package; not exported from the barrel.

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** The JSON in an event's data line, or the raw text when it is not JSON. */
export function parseData(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** A query-string flag of the current page, such as `?live=1`; null when absent or outside a browser. */
export function searchFlag(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

/** True in an automated or embedded browser (`navigator.webdriver`): features that would keep `networkidle` from settling stay off. */
export function isTestBrowser(): boolean {
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}
