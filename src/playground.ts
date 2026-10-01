/** Raw shape of `window.__PLAYGROUND__` as injected by the Go `spa` package (snake_case JSON). */
export interface PlaygroundRaw {
  app_name?: string;
  env?: string;
  claude_session_url?: string;
  /** The platform domain (`teb.ooo`), when the server sends it. */
  platform_domain?: string;
  /** true when the app enables the end-user assistant. */
  assistant?: boolean;
  locale?: string;
  timezone?: string;
}

/** Typed, camelCase view of `window.__PLAYGROUND__`. Every field has a safe default. */
export interface PlaygroundConfig {
  appName: string;
  env: string;
  claudeSessionUrl: string;
  /** The platform domain, or "" when the server does not send it (`platformDomain()` then derives it from the host). */
  platformDomain: string;
  /** true when the app enables the end-user assistant (`/assistant` route). false when absent. */
  assistant: boolean;
  locale: string;
  timezone: string;
}

declare global {
  interface Window {
    __PLAYGROUND__?: PlaygroundRaw;
  }
}

export const DEFAULT_LOCALE = "en-US";
export const DEFAULT_TIMEZONE = "UTC";

function readRaw(): PlaygroundRaw {
  if (typeof window === "undefined") return {};
  const raw: unknown = window.__PLAYGROUND__;
  return raw !== null && typeof raw === "object" ? (raw as PlaygroundRaw) : {};
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v !== "" ? v : fallback;
}

function validLocale(v: string): string {
  try {
    return Intl.getCanonicalLocales(v)[0] ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function validTimezone(v: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return v;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Reads `window.__PLAYGROUND__` fresh on every call. Safe when absent (tests, SSR). */
export function getPlayground(): PlaygroundConfig {
  const raw = readRaw();
  return {
    appName: str(raw.app_name, ""),
    env: str(raw.env, ""),
    claudeSessionUrl: str(raw.claude_session_url, ""),
    platformDomain: str(raw.platform_domain, ""),
    assistant: raw.assistant === true,
    locale: validLocale(str(raw.locale, DEFAULT_LOCALE)),
    timezone: validTimezone(str(raw.timezone, DEFAULT_TIMEZONE)),
  };
}

/** Live view: property reads always reflect the current `window.__PLAYGROUND__`. */
export const playground: Readonly<PlaygroundConfig> = Object.defineProperties({} as PlaygroundConfig, {
  appName: { enumerable: true, get: () => getPlayground().appName },
  env: { enumerable: true, get: () => getPlayground().env },
  claudeSessionUrl: { enumerable: true, get: () => getPlayground().claudeSessionUrl },
  platformDomain: { enumerable: true, get: () => getPlayground().platformDomain },
  assistant: { enumerable: true, get: () => getPlayground().assistant },
  locale: { enumerable: true, get: () => getPlayground().locale },
  timezone: { enumerable: true, get: () => getPlayground().timezone },
});
