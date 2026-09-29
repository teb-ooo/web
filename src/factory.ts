/** Raw shape of `window.__FACTORY__` as injected by the Go `spa` package (snake_case JSON). */
export interface FactoryRaw {
  app_name?: string;
  env?: string;
  claude_session_url?: string;
  /** true when the app enables the end-user assistant. */
  assistant?: boolean;
  locale?: string;
  timezone?: string;
}

/** Typed, camelCase view of `window.__FACTORY__`. Every field has a safe default. */
export interface FactoryConfig {
  appName: string;
  env: string;
  claudeSessionUrl: string;
  /** true when the app enables the end-user assistant (`/assistant` route). false when absent. */
  assistant: boolean;
  locale: string;
  timezone: string;
}

declare global {
  interface Window {
    __FACTORY__?: FactoryRaw;
  }
}

export const DEFAULT_LOCALE = "en-US";
export const DEFAULT_TIMEZONE = "UTC";

function readRaw(): FactoryRaw {
  if (typeof window === "undefined") return {};
  const raw: unknown = window.__FACTORY__;
  return raw !== null && typeof raw === "object" ? (raw as FactoryRaw) : {};
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

/** Reads `window.__FACTORY__` fresh on every call. Safe when absent (tests, SSR). */
export function getFactory(): FactoryConfig {
  const raw = readRaw();
  return {
    appName: str(raw.app_name, ""),
    env: str(raw.env, ""),
    claudeSessionUrl: str(raw.claude_session_url, ""),
    assistant: raw.assistant === true,
    locale: validLocale(str(raw.locale, DEFAULT_LOCALE)),
    timezone: validTimezone(str(raw.timezone, DEFAULT_TIMEZONE)),
  };
}

/** Live view: property reads always reflect the current `window.__FACTORY__`. */
export const factory: Readonly<FactoryConfig> = Object.defineProperties({} as FactoryConfig, {
  appName: { enumerable: true, get: () => getFactory().appName },
  env: { enumerable: true, get: () => getFactory().env },
  claudeSessionUrl: { enumerable: true, get: () => getFactory().claudeSessionUrl },
  assistant: { enumerable: true, get: () => getFactory().assistant },
  locale: { enumerable: true, get: () => getFactory().locale },
  timezone: { enumerable: true, get: () => getFactory().timezone },
});
