import { describe, expect, it } from "vitest";
import { playground, getPlayground } from "../src/playground.js";
import { setPlayground } from "../src/testing.js";

describe("playground", () => {
  it("is safe when window.__PLAYGROUND__ is absent", () => {
    expect(getPlayground()).toEqual({
      appName: "",
      env: "",
      claudeSessionUrl: "",
      platformDomain: "",
      locale: "en-US",
      timezone: "UTC",
    });
  });

  it("maps snake_case to camelCase", () => {
    setPlayground({
      app_name: "hello",
      env: "staging",
      claude_session_url: "https://claude.ai/code/session_1",
      platform_domain: "teb.ooo",
      locale: "en-GB",
      timezone: "Europe/London",
    });
    expect(getPlayground()).toEqual({
      appName: "hello",
      env: "staging",
      claudeSessionUrl: "https://claude.ai/code/session_1",
      platformDomain: "teb.ooo",
      locale: "en-GB",
      timezone: "Europe/London",
    });
  });

  it("exposes a live view", () => {
    expect(playground.appName).toBe("");
    setPlayground({ app_name: "later" });
    expect(playground.appName).toBe("later");
  });


  it("ignores junk values", () => {
    (window as unknown as { __PLAYGROUND__: unknown }).__PLAYGROUND__ = "junk";
    expect(getPlayground().appName).toBe("");
    (window as unknown as { __PLAYGROUND__: unknown }).__PLAYGROUND__ = { app_name: 3 };
    expect(getPlayground().appName).toBe("");
  });
});
