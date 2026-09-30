import { describe, expect, it } from "vitest";
import { playground, getPlayground } from "../src/playground.js";
import { setPlayground } from "../src/testing.js";

describe("playground", () => {
  it("is safe when window.__PLAYGROUND__ is absent", () => {
    expect(getPlayground()).toEqual({
      appName: "",
      env: "",
      claudeSessionUrl: "",
      assistant: false,
      locale: "en-US",
      timezone: "UTC",
    });
  });

  it("maps snake_case to camelCase", () => {
    setPlayground({
      app_name: "hello",
      env: "staging",
      claude_session_url: "https://claude.ai/code/session_1",
      assistant: true,
      locale: "en-GB",
      timezone: "Europe/London",
    });
    expect(getPlayground()).toEqual({
      appName: "hello",
      env: "staging",
      claudeSessionUrl: "https://claude.ai/code/session_1",
      assistant: true,
      locale: "en-GB",
      timezone: "Europe/London",
    });
  });

  it("exposes a live view", () => {
    expect(playground.appName).toBe("");
    setPlayground({ app_name: "later" });
    expect(playground.appName).toBe("later");
  });

  it("assistant is strictly boolean true, else false", () => {
    for (const v of ["true", 1, null, undefined, false]) {
      (window as unknown as { __PLAYGROUND__: unknown }).__PLAYGROUND__ = { assistant: v };
      expect(getPlayground().assistant).toBe(false);
    }
    setPlayground({ assistant: true });
    expect(playground.assistant).toBe(true);
  });

  it("ignores junk values", () => {
    (window as unknown as { __PLAYGROUND__: unknown }).__PLAYGROUND__ = "junk";
    expect(getPlayground().appName).toBe("");
    (window as unknown as { __PLAYGROUND__: unknown }).__PLAYGROUND__ = { app_name: 3 };
    expect(getPlayground().appName).toBe("");
  });
});
