import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { matchesPaths, useLiveQueries } from "../src/live-queries.js";

const enc = new TextEncoder();
/** Queries made with setQueryData have no observers, so keep them from being garbage collected. */
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const WORK = ["get", "/api/work/issues", { params: { query: { limit: 50 } } }] as const;
const WORK_ONE = ["get", "/api/work/issues/{id}", { params: { path: { id: "x" } } }] as const;
const OTHER = ["get", "/api/people", {}] as const;

/** A fetch whose streams the test drives: `push` writes an event to the open one, `end` ends it. */
function fakeStream() {
  const requests: Headers[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Headers(init?.headers));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  return {
    requests,
    fetch,
    push: (text: string) => controller?.enqueue(enc.encode(text)),
    end: () => controller?.close(),
  };
}

function setup(qc: QueryClient) {
  qc.setQueryData([...WORK], { items: [] });
  qc.setQueryData([...WORK_ONE], { id: "x" });
  qc.setQueryData([...OTHER], { items: [] });
  return ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}
const stale = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState([...key])?.isInvalidated === true;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("matchesPaths", () => {
  it("matches the path template of a generated-hook key by prefix", () => {
    const qc = newClient();
    setup(qc);
    const m = matchesPaths(["/api/work/"]);
    const q = (key: readonly unknown[]) => qc.getQueryCache().find({ queryKey: [...key] })!;
    expect(m(q(WORK))).toBe(true);
    expect(m(q(WORK_ONE))).toBe(true);
    expect(m(q(OTHER))).toBe(false);
  });
});

describe("useLiveQueries", () => {
  it("is live once the stream opens, and a burst of events makes one invalidation of the matching queries", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const spy = vi.spyOn(qc, "invalidateQueries");
    const s = fakeStream();
    const { result } = renderHook(() => useLiveQueries({ url: "http://localhost/events", invalidate: ["/api/work/"], debounceMs: 40, transport: { fetch: s.fetch } }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => s.push('id: 1\ndata: {"project":"a"}\n\nid: 2\ndata: {"project":"a"}\n\nid: 3\ndata: {"project":"b"}\n\n'));
    await waitFor(() => expect(stale(qc, WORK)).toBe(true));
    expect(stale(qc, WORK_ONE)).toBe(true);
    expect(stale(qc, OTHER)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("onEvent can ignore an event", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const seen: unknown[] = [];
    const { result } = renderHook(
      () =>
        useLiveQueries({
          url: "http://localhost/events",
          invalidate: ["/api/work/"],
          debounceMs: 20,
          onEvent: (d) => {
            seen.push(d);
            return (d as { project: string }).project === "mine";
          },
          transport: { fetch: s.fetch },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => s.push('data: {"project":"other"}\n\n'));
    await waitFor(() => expect(seen).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 60));
    expect(stale(qc, WORK)).toBe(false);
    act(() => s.push('data: {"project":"mine"}\n\n'));
    await waitFor(() => expect(stale(qc, WORK)).toBe(true));
  });

  it("after a dropped connection it reconnects with Last-Event-ID and invalidates once without waiting for an event", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const { result } = renderHook(
      () =>
        useLiveQueries({
          url: "http://localhost/events",
          invalidate: ["/api/work/"],
          debounceMs: 10,
          transport: { fetch: s.fetch, sleep: async () => undefined },
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => s.push('id: 7\ndata: {}\n\n'));
    await waitFor(() => expect(stale(qc, WORK)).toBe(true));
    qc.setQueryData([...WORK], { items: [] }); // fresh again
    expect(stale(qc, WORK)).toBe(false);
    act(() => s.end());
    await waitFor(() => expect(s.requests.length).toBe(2));
    expect(s.requests[1]?.get("Last-Event-ID")).toBe("7");
    await waitFor(() => expect(stale(qc, WORK)).toBe(true));
  });

  it("closes the stream while the tab is hidden and refreshes when it is shown again", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const { result } = renderHook(() => useLiveQueries({ url: "http://localhost/events", invalidate: ["/api/work/"], transport: { fetch: s.fetch } }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => setVisibility("hidden"));
    await waitFor(() => expect(result.current.status).toBe("off"));
    expect(result.current.paused).toBe(true);
    qc.setQueryData([...WORK], { items: [] });
    act(() => setVisibility("visible"));
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(result.current.paused).toBe(false);
    await waitFor(() => expect(stale(qc, WORK)).toBe(true));
    expect(s.requests.length).toBe(2);
  });

  it("keeps trying, honestly 'reconnecting', while the server answers 503 or 404, then goes live", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const codes = [503, 404];
    const delays: number[] = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const code = codes.shift();
      if (code !== undefined) return new Response("{}", { status: code, headers: { "Content-Type": "application/problem+json" } });
      return s.fetch(input, init);
    };
    const { result } = renderHook(
      () => useLiveQueries({ url: "http://localhost/events", invalidate: ["/api/work/"], transport: { fetch, sleep: async (ms) => void delays.push(ms) } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(delays).toHaveLength(2);
    expect(delays.every((d) => d <= 30_000)).toBe(true);
  });

  it("stays off without a url or when disabled", () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const a = renderHook(() => useLiveQueries({ url: null, invalidate: ["/api/"], transport: { fetch: s.fetch } }), { wrapper });
    const b = renderHook(() => useLiveQueries({ url: "http://localhost/events", enabled: false, invalidate: ["/api/"], transport: { fetch: s.fetch } }), { wrapper });
    expect(a.result.current.status).toBe("off");
    expect(b.result.current.status).toBe("off");
    expect(s.requests.length).toBe(0);
  });

  it("accepts a predicate for invalidate", async () => {
    const qc = newClient();
    const wrapper = setup(qc);
    const s = fakeStream();
    const { result } = renderHook(
      () => useLiveQueries({ url: "http://localhost/events", invalidate: (q) => q.queryKey[1] === "/api/people", debounceMs: 10, transport: { fetch: s.fetch } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => s.push("data: {}\n\n"));
    await waitFor(() => expect(stale(qc, OTHER)).toBe(true));
    expect(stale(qc, WORK)).toBe(false);
  });
});
