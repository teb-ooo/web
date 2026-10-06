import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resourceOfPath, useLive } from "../src/live.js";

const enc = new TextEncoder();
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const WIDGETS = ["get", "/api/widgets", {}] as const;
const WIDGET = ["get", "/api/widgets/{id}", { params: { path: { id: "1" } } }] as const;
const PEOPLE = ["get", "/api/people", {}] as const;
const WORK = ["get", "/api/work/issues", {}] as const;
const ME = ["auth", "me"] as const;

function fakeStream() {
  const requests: string[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetch = async (input: RequestInfo | URL) => {
    requests.push(String(input));
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  return { requests, fetch, push: (t: string) => controller?.enqueue(enc.encode(t)), end: () => controller?.close() };
}

function setup(qc: QueryClient) {
  for (const k of [WIDGETS, WIDGET, PEOPLE, WORK, ME]) qc.setQueryData([...k], {});
  return ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}
const stale = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState([...key])?.isInvalidated === true;
const fresh = (qc: QueryClient, key: readonly unknown[]) => qc.setQueryData([...key], {});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
});

describe("resourceOfPath", () => {
  it("is the first path segment after /api/", () => {
    expect(resourceOfPath("/api/widgets")).toBe("widgets");
    expect(resourceOfPath("/api/widgets/{id}")).toBe("widgets");
    expect(resourceOfPath("/api/work/issues/{id}")).toBe("work");
    expect(resourceOfPath("/auth/me")).toBeNull();
  });
});

describe("useLive", () => {
  const opts = (s: ReturnType<typeof fakeStream>, more: object = {}) => ({ debounceMs: 10, jitterMs: 0, transport: { fetch: s.fetch, sleep: async () => undefined }, ...more });

  it("connects to /api/live and an event invalidates only the queries of the resource it names", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const { result } = renderHook(() => useLive(opts(s)), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(s.requests[0]).toContain("/api/live");
    act(() => s.push('event: change\nid: v1\ndata: {"resource":"widgets","version":"v1"}\n\n'));
    await waitFor(() => expect(stale(qc, WIDGETS)).toBe(true));
    expect(stale(qc, WIDGET)).toBe(true);
    expect(stale(qc, PEOPLE)).toBe(false);
    expect(stale(qc, WORK)).toBe(false);
    expect(stale(qc, ME)).toBe(false);
  });

  it("an event with an id still refetches every query of the resource: the id is for onEvent, not for narrowing", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const seen: unknown[] = [];
    const { result } = renderHook(() => useLive(opts(s, { onEvent: (d: unknown) => void seen.push(d) })), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => s.push('event: change\nid: 1\ndata: {"resource":"widgets","id":"2","project":"p"}\n\n'));
    await waitFor(() => expect(stale(qc, WIDGETS)).toBe(true));
    expect(stale(qc, WIDGET)).toBe(true); // the detail query of id "1" too
    expect(stale(qc, PEOPLE)).toBe(false);
    expect(seen).toEqual([{ resource: "widgets", id: "2", project: "p" }]);
  });

  it("an event naming no resource refreshes everything under /api/ but not other queries", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const { result } = renderHook(() => useLive(opts(s)), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => s.push('event: change\ndata: {"version":"v2"}\n\n'));
    await waitFor(() => expect(stale(qc, PEOPLE)).toBe(true));
    expect(stale(qc, WIDGETS)).toBe(true);
    expect(stale(qc, ME)).toBe(false);
  });

  it("the resources map overrides the convention", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const { result } = renderHook(() => useLive(opts(s, { resources: { beads: ["/api/work/"] } })), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => s.push('event: change\ndata: {"resource":"beads"}\n\n'));
    await waitFor(() => expect(stale(qc, WORK)).toBe(true));
    expect(stale(qc, WIDGETS)).toBe(false);
  });

  it("stays off in a test browser and with ?live=0, and can be forced on", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    const off = renderHook(() => useLive(opts(s)), { wrapper });
    expect(off.result.current.status).toBe("off");
    expect(s.requests).toHaveLength(0);
    off.unmount();

    const forced = renderHook(() => useLive(opts(s, { force: true })), { wrapper });
    await waitFor(() => expect(forced.result.current.status).toBe("live"));
    forced.unmount();

    window.history.replaceState(null, "", "/?live=1");
    const byUrl = renderHook(() => useLive(opts(s)), { wrapper });
    await waitFor(() => expect(byUrl.result.current.status).toBe("live"));
    byUrl.unmount();

    Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
    window.history.replaceState(null, "", "/?live=0");
    const zero = renderHook(() => useLive(opts(s)), { wrapper });
    expect(zero.result.current.status).toBe("off");
  });

  it("keeps the page's ?live=1 or ?live=0 when navigation drops the query string", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    window.history.replaceState(null, "", "/?live=1");
    const on = renderHook(() => useLive(opts(s)), { wrapper });
    await waitFor(() => expect(on.result.current.status).toBe("live"));
    window.history.replaceState(null, "", "/other"); // a client-side navigation: the query string is gone
    on.rerender();
    expect(on.result.current.status).toBe("live");
    on.unmount();

    Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
    window.history.replaceState(null, "", "/?live=0");
    const off = renderHook(() => useLive(opts(s)), { wrapper });
    expect(off.result.current.status).toBe("off");
    window.history.replaceState(null, "", "/other");
    off.rerender();
    expect(off.result.current.status).toBe("off");
  });

  it("a degraded event shows degraded until the next change", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const { result } = renderHook(() => useLive(opts(s)), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => s.push('event: degraded\ndata: {"reason":"beads source down"}\n\n'));
    await waitFor(() => expect(result.current.status).toBe("degraded"));
    act(() => s.push('event: change\ndata: {"resource":"widgets"}\n\n'));
    await waitFor(() => expect(result.current.status).toBe("live"));
  });

  it("after a reconnect it refreshes everything after a random delay of up to jitterMs", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const { result } = renderHook(() => useLive(opts(s, { jitterMs: 120, random: () => 1 })), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => s.end());
    await waitFor(() => expect(s.requests.length).toBe(2));
    await new Promise((r) => setTimeout(r, 40));
    expect(stale(qc, PEOPLE)).toBe(false); // still waiting out the delay
    await waitFor(() => expect(stale(qc, PEOPLE)).toBe(true), { timeout: 1000 });
  });

  it("does not poll by default, and polls while not live when asked", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const failing = async () => new Response("{}", { status: 503 });
    const a = renderHook(() => useLive({ transport: { fetch: failing, sleep: () => new Promise(() => undefined) } }), { wrapper });
    await waitFor(() => expect(a.result.current.status).toBe("reconnecting"));
    await new Promise((r) => setTimeout(r, 60));
    expect(stale(qc, PEOPLE)).toBe(false);
    a.unmount();

    const b = renderHook(() => useLive({ pollWhenNotLiveMs: 20, transport: { fetch: failing, sleep: () => new Promise(() => undefined) } }), { wrapper });
    await waitFor(() => expect(stale(qc, PEOPLE)).toBe(true));
    b.unmount();
    fresh(qc, PEOPLE);
  });
});
