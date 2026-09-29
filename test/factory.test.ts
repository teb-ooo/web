import { describe, expect, it } from "vitest";
import { factory, getFactory } from "../src/factory.js";
import { setFactory } from "../src/testing.js";

describe("factory", () => {
  it("is safe when window.__FACTORY__ is absent", () => {
    expect(getFactory()).toEqual({
      appName: "",
      env: "",
      agentUrl: "",
      claudeSessionUrl: "",
      assistant: false,
      locale: "en-US",
      timezone: "UTC",
    });
  });

  it("maps snake_case to camelCase", () => {
    setFactory({
      app_name: "hello",
      env: "staging",
      agent_url: "/_agent/tty/",
      claude_session_url: "https://claude.ai/code/session_1",
      assistant: true,
      locale: "en-GB",
      timezone: "Europe/London",
    });
    expect(getFactory()).toEqual({
      appName: "hello",
      env: "staging",
      agentUrl: "/_agent/tty/",
      claudeSessionUrl: "https://claude.ai/code/session_1",
      assistant: true,
      locale: "en-GB",
      timezone: "Europe/London",
    });
  });

  it("exposes a live view", () => {
    expect(factory.appName).toBe("");
    setFactory({ app_name: "later" });
    expect(factory.appName).toBe("later");
  });

  it("assistant is strictly boolean true, else false", () => {
    for (const v of ["true", 1, null, undefined, false]) {
      (window as unknown as { __FACTORY__: unknown }).__FACTORY__ = { assistant: v };
      expect(getFactory().assistant).toBe(false);
    }
    setFactory({ assistant: true });
    expect(factory.assistant).toBe(true);
  });

  it("ignores junk values", () => {
    (window as unknown as { __FACTORY__: unknown }).__FACTORY__ = "junk";
    expect(getFactory().appName).toBe("");
    (window as unknown as { __FACTORY__: unknown }).__FACTORY__ = { app_name: 3, agent_url: null };
    expect(getFactory().appName).toBe("");
    expect(getFactory().agentUrl).toBe("");
  });
});
