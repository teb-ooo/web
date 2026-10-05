import { getPlayground } from "./playground.js";

export type DateInput = Date | string | number | null | undefined;

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Intl.DateTimeFormat refuses dateStyle or timeStyle together with these field options, so the style defaults apply only
// when the caller asked for no field.
const FIELD_OPTIONS = ["weekday", "era", "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits", "timeZoneName"] as const;
const hasField = (o: Intl.DateTimeFormatOptions | undefined): boolean => o !== undefined && FIELD_OPTIONS.some((k) => o[k] !== undefined);

/** Date only, e.g. "Sep 29, 2026", in the playground locale and timezone. Empty string for missing/invalid input. */
export function fmtDate(v: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(v);
  if (!d) return "";
  const { locale, timezone } = getPlayground();
  return new Intl.DateTimeFormat(locale, { ...(hasField(options) ? {} : { dateStyle: "medium" as const }), timeZone: timezone, ...options }).format(d);
}

/** Date and time, e.g. "Sep 29, 2026, 6:30 AM". Empty string for missing/invalid input. */
export function fmtDateTime(v: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(v);
  if (!d) return "";
  const { locale, timezone } = getPlayground();
  return new Intl.DateTimeFormat(locale, {
    ...(hasField(options) ? {} : { dateStyle: "medium" as const, timeStyle: "short" as const }),
    timeZone: timezone,
    ...options,
  }).format(d);
}

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "3 hours ago", "in 2 days", "now". `now` is injectable for deterministic tests. */
export function fmtRelative(v: DateInput, now: Date | number = Date.now()): string {
  const d = toDate(v);
  if (!d) return "";
  const nowMs = now instanceof Date ? now.getTime() : now;
  const diffSec = Math.round((d.getTime() - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  const { locale } = getPlayground();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === "second") {
      return rtf.format(Math.trunc(diffSec / secs), unit);
    }
  }
  return rtf.format(0, "second");
}

/** Locale-aware number. Empty string for null/undefined/NaN. */
export function fmtNumber(v: number | null | undefined, options?: Intl.NumberFormatOptions): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  return new Intl.NumberFormat(getPlayground().locale, options).format(v);
}

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte", "petabyte"] as const;

/** Human size in SI units (1 kB = 1000 B), e.g. "1.5 MB". */
export function fmtBytes(v: number | null | undefined, fractionDigits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  const sign = v < 0 ? -1 : 1;
  let n = Math.abs(v);
  let i = 0;
  while (n >= 1000 && i < BYTE_UNITS.length - 1) {
    n /= 1000;
    i++;
  }
  const unit = BYTE_UNITS[i] ?? "byte";
  return new Intl.NumberFormat(getPlayground().locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: i === 0 ? 0 : fractionDigits,
  }).format(sign * n);
}
