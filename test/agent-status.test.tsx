import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useAgentStatus } from "../src/agent-status.js";
import { HttpResponse, createTestQueryClient, http, setupMswServer } from "../src/testing.js";

const server = setupMswServer();
const me = (extra: object) => http.get("*/auth/me", () => HttpResponse.json({ subject: "s", email: "a@b.c", username: "a", groups: [], is_admin: false, ...extra }));

function wrapper() {
  const qc = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
});

describe("useAgentStatus", () => {
  it("reads the status for the owner and polls again", async () => {
    let hits = 0;
    server.use(
      me({ is_owner: true }),
      http.get("*/_playground/agent", () => {
        hits += 1;
        return HttpResponse.json({ agent: "ui", status: hits === 1 ? "working" : "idle", since: "2026-10-02T01:00:00Z", summary: "building" });
      }),
    );
    const { result } = renderHook(() => useAgentStatus({ intervalMs: 50 }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current?.status).toBe("working"));
    expect(result.current?.agent).toBe("ui");
    await waitFor(() => expect(result.current?.status).toBe("idle"));
  });

  it("is null for someone who is not the owner and asks nothing", async () => {
    let hits = 0;
    server.use(me({}), http.get("*/_playground/agent", () => ((hits += 1), HttpResponse.json({ status: "idle" }))));
    const { result } = renderHook(() => useAgentStatus({ intervalMs: 50 }), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 150));
    expect(result.current).toBeNull();
    expect(hits).toBe(0);
  });

  it.each([
    ["a missing route", () => HttpResponse.json({}, { status: 404 })],
    ["forbidden", () => HttpResponse.json({}, { status: 403 })],
    ["an unknown status", () => HttpResponse.json({ status: "dancing" })],
    ["a server error", () => HttpResponse.json({}, { status: 500 })],
  ])("is null for %s (the bar draws no dot)", async (_name, answer) => {
    server.use(me({ is_owner: true }), http.get("*/_playground/agent", answer));
    const { result } = renderHook(() => useAgentStatus({ intervalMs: 50 }), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current).toBeNull();
  });

  it("stays off in a test browser unless forced", async () => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    let hits = 0;
    server.use(me({ is_owner: true }), http.get("*/_playground/agent", () => ((hits += 1), HttpResponse.json({ status: "idle" }))));
    const off = renderHook(() => useAgentStatus({ intervalMs: 50 }), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 150));
    expect(off.result.current).toBeNull();
    expect(hits).toBe(0);
    off.unmount();
    const on = renderHook(() => useAgentStatus({ intervalMs: 50, force: true }), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current?.status).toBe("idle"));
  });
});
