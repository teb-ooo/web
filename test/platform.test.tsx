import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clearLiveStatus, publishLiveStatus } from "../src/live-status";
import { LOGOUT_PATH, platformDomain, platformLinks, platformUrl } from "../src/platform";
import { useHasLiveStream, useLiveStatus } from "../src";

afterEach(() => {
  delete window.__PLAYGROUND__;
});

describe("platformDomain", () => {
  it.each([
    ["ui-staging.teb.ooo", "teb.ooo"],
    ["ui.teb.ooo", "teb.ooo"],
    ["localhost", null],
    ["127.0.0.1", null],
    ["teb.ooo", null],
    ["", null],
  ])("derives from the host %j", (host, want) => {
    expect(platformDomain(host)).toBe(want);
  });
  it("prefers the domain the server sends", () => {
    window.__PLAYGROUND__ = { platform_domain: "example.test" };
    expect(platformDomain("localhost")).toBe("example.test");
    expect(platformUrl("id", "/profile")).toBe("https://id.example.test/profile");
  });
});

describe("platformUrl on staging", () => {
  it("stays on staging when the server says env is staging, and on production otherwise", () => {
    window.__PLAYGROUND__ = { platform_domain: "example.test", env: "staging" };
    expect(platformUrl("ah", "/")).toBe("https://ah-staging.example.test/");
    expect(platformLinks().every((l) => l.href.includes("-staging.example.test"))).toBe(true);
    window.__PLAYGROUND__ = { platform_domain: "example.test", env: "production" };
    expect(platformUrl("ah", "/")).toBe("https://ah.example.test/");
  });
});

describe("platformLinks", () => {
  it("lists the profile, dashboard, tracker and design system on the platform domain", () => {
    window.__PLAYGROUND__ = { platform_domain: "example.test" };
    const links = platformLinks();
    expect(links.map((l) => l.href)).toEqual([
      "https://id.example.test/profile",
      "https://ah.example.test/",
      "https://bd.example.test/",
      "https://ui.example.test/",
    ]);
    expect(new Set(links.map((l) => l.id)).size).toBe(links.length);
  });
  it("is empty where the domain is unknown", () => {
    expect(platformLinks()).toEqual([]);
  });
  it("signs out through the app's own route", () => {
    expect(LOGOUT_PATH).toBe("/auth/logout");
  });
});

describe("useLiveStatus", () => {
  it("is the worst status of the mounted streams and off with none", () => {
    const { result } = renderHook(() => useLiveStatus());
    expect(result.current).toBe("off");
    act(() => publishLiveStatus("a", "reconnecting"));
    expect(result.current).toBe("reconnecting");
    act(() => publishLiveStatus("b", "degraded"));
    expect(result.current).toBe("degraded");
    act(() => publishLiveStatus("c", "live"));
    expect(result.current).toBe("degraded"); // one healthy stream does not hide a broken one
    act(() => {
      clearLiveStatus("c");
      clearLiveStatus("b");
    });
    expect(result.current).toBe("reconnecting");
    act(() => clearLiveStatus("a"));
    expect(result.current).toBe("off");
  });
});

describe("useHasLiveStream", () => {
  it("is true only while a stream is registered", () => {
    const { result } = renderHook(() => useHasLiveStream());
    expect(result.current).toBe(false);
    act(() => publishLiveStatus("x", "off"));
    expect(result.current).toBe(true);
    act(() => clearLiveStatus("x"));
    expect(result.current).toBe(false);
  });
});
