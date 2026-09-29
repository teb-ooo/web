import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fmtBytes, fmtDate, fmtDateTime, fmtNumber, fmtRelative } from "../src/fmt.js";
import { setFactory } from "../src/testing.js";

const T = new Date("2026-09-29T06:30:00Z");

describe("fmt defaults (no window.__FACTORY__)", () => {
  it("uses en-US and UTC", () => {
    expect(fmtDate(T)).toBe("Sep 29, 2026");
    expect(fmtDateTime(T)).toBe("Sep 29, 2026, 6:30 AM");
    expect(fmtNumber(1234567.891)).toBe("1,234,567.891");
  });
  it("accepts strings and epoch ms, and returns empty for missing/invalid", () => {
    expect(fmtDate("2026-09-29T06:30:00Z")).toBe("Sep 29, 2026");
    expect(fmtDate(T.getTime())).toBe("Sep 29, 2026");
    expect(fmtDate(null)).toBe("");
    expect(fmtDate(undefined)).toBe("");
    expect(fmtDate("nope")).toBe("");
    expect(fmtNumber(null)).toBe("");
    expect(fmtBytes(undefined)).toBe("");
  });
});

describe("fmt with locale and timezone from window.__FACTORY__", () => {
  it("applies timezone", () => {
    setFactory({ timezone: "America/Los_Angeles" });
    expect(fmtDateTime(T)).toBe("Sep 28, 2026, 11:30 PM");
    expect(fmtDate(T)).toBe("Sep 28, 2026");
  });
  it("applies locale", () => {
    setFactory({ locale: "de-DE" });
    expect(fmtNumber(1234567.891)).toBe("1.234.567,891");
    expect(fmtDate(T)).toBe("29.09.2026");
  });
  it("falls back for invalid locale/timezone", () => {
    setFactory({ locale: "not a locale!!", timezone: "Mars/Olympus" });
    expect(fmtDate(T)).toBe("Sep 29, 2026");
  });
});

describe("fmtRelative with a fixed clock", () => {
  const now = T;
  const at = (ms: number) => new Date(now.getTime() + ms);
  it("past and future", () => {
    expect(fmtRelative(at(-3 * 3600_000), now)).toBe("3 hours ago");
    expect(fmtRelative(at(2 * 86400_000), now)).toBe("in 2 days");
    expect(fmtRelative(at(-86400_000), now)).toBe("yesterday");
    expect(fmtRelative(at(-150_000), now)).toBe("2 minutes ago");
    expect(fmtRelative(at(0), now)).toBe("now");
    expect(fmtRelative(at(-400 * 86400_000), now)).toBe("last year");
  });
  it("defaults now to Date.now (fake timers)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(fmtRelative(at(-5 * 60_000))).toBe("5 minutes ago");
    vi.useRealTimers();
  });
  it("respects locale", () => {
    setFactory({ locale: "fr-FR" });
    expect(fmtRelative(at(-3 * 3600_000), now)).toBe("il y a 3 heures");
  });
});

describe("fmtBytes", () => {
  beforeEach(() => setFactory({}));
  afterEach(() => undefined);
  it("scales in SI units", () => {
    expect(fmtBytes(0)).toBe("0 byte");
    expect(fmtBytes(512)).toBe("512 byte");
    expect(fmtBytes(1500)).toBe("1.5 kB");
    expect(fmtBytes(1_500_000)).toBe("1.5 MB");
    expect(fmtBytes(2_000_000_000)).toBe("2 GB");
    expect(fmtBytes(-1500)).toBe("-1.5 kB");
  });
});
