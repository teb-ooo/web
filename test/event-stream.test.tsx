import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "../src/api-error.js";
import { backoffDelay, useEventStream } from "../src/event-stream.js";

/** The events of the streams these tests feed. */
interface AssistantEvents {
  text: { text: string };
  tool_call: { id: string; name: string; input: unknown };
  tool_result: { id: string; content: unknown; is_error?: boolean };
  done: { stop_reason?: string };
  error: { detail: string };
}
import { HttpResponse, http, problemResponse, setupMswServer, sseResponse } from "../src/testing.js";

const server = setupMswServer();
const URL_ = "http://localhost:3000/api/stream";
const enc = new TextEncoder();

/** Sleep that resolves immediately and records requested delays. */
function fastSleep() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

/** fetch wrapper that records the AbortSignals it was given. */
function spyFetch() {
  const signals: AbortSignal[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return globalThis.fetch(input, init);
  };
  return { signals, fetch };
}

describe("backoffDelay", () => {
  it("doubles, caps, and jitters between half and full", () => {
    expect(backoffDelay(0, { random: () => 1 })).toBe(500);
    expect(backoffDelay(0, { random: () => 0 })).toBe(250);
    expect(backoffDelay(1, { random: () => 1 })).toBe(1000);
    expect(backoffDelay(3, { random: () => 1 })).toBe(4000);
    expect(backoffDelay(20, { random: () => 1 })).toBe(30_000);
    expect(backoffDelay(20, { random: () => 0 })).toBe(15_000);
    expect(backoffDelay(2, { baseMs: 100, maxMs: 250, random: () => 1 })).toBe(250);
  });
});

describe("useEventStream (GET)", () => {
  it("parses events split across reads and dispatches typed handlers", async () => {
    server.use(
      http.get(URL_, () =>
        sseResponse([
          'event: te',
          'xt\ndata: {"te',
          'xt":"Hel"}\n\nevent: text\ndata: {"text":"lo"}\n',
          '\nevent: tool_call\ndata: {"id":"1","name":"list_items","input":{}}\n\n',
          'event: done\ndata: {"stop_reason":"end_turn"}\n\n',
        ]),
      ),
    );
    const text: string[] = [];
    const calls: string[] = [];
    const done = vi.fn();
    const { result } = renderHook(() =>
      useEventStream<AssistantEvents>(URL_, {
        text: (d) => text.push(d.text),
        tool_call: (d, meta) => calls.push(`${meta.event}:${d.name}`),
        done,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("closed"));
    expect(text.join("")).toBe("Hello");
    expect(calls).toEqual(["tool_call:list_items"]);
    expect(done).toHaveBeenCalledWith({ stop_reason: "end_turn" }, { event: "done" });
  });

  it("delivers non-JSON data as a string and ignores events without a handler", async () => {
    server.use(http.get(URL_, () => sseResponse(["event: ping\ndata: x\n\ndata: plain text\n\nevent: done\ndata: {}\n\n"])));
    const got: unknown[] = [];
    renderHook(() => useEventStream<{ message: string; done: unknown }>(URL_, { message: (d) => got.push(d) }));
    await waitFor(() => expect(got).toEqual(["plain text"]));
  });

  it("reconnects with backoff after the stream drops, resuming with Last-Event-ID", async () => {
    const lastIds: (string | null)[] = [];
    let n = 0;
    server.use(
      http.get(URL_, ({ request }) => {
        lastIds.push(request.headers.get("last-event-id"));
        n++;
        if (n === 1) return sseResponse(["id: 1\nevent: text\ndata: {\"text\":\"a\"}\n\n"]);
        if (n === 2) return HttpResponse.error();
        return sseResponse(["id: 2\nevent: text\ndata: {\"text\":\"b\"}\n\nevent: done\ndata: {}\n\n"]);
      }),
    );
    const { delays, sleep } = fastSleep();
    const text: string[] = [];
    const errors: Error[] = [];
    const { result } = renderHook(() =>
      useEventStream<AssistantEvents>(URL_, { text: (d) => text.push(d.text) }, { sleep, onError: (e) => errors.push(e), reconnect: { random: () => 1 } }),
    );
    await waitFor(() => expect(result.current.status).toBe("closed"));
    expect(text).toEqual(["a", "b"]);
    expect(lastIds).toEqual([null, "1", "1"]);
    expect(errors).toHaveLength(1);
    // first drop after a delivered event resets attempt (500), then a network failure backs off (1000)
    expect(delays).toEqual([500, 1000]);
  });

  it("uses the server's retry: value for the delay", async () => {
    let n = 0;
    server.use(
      http.get(URL_, () => (++n === 1 ? sseResponse(["retry: 1234\ndata: 1\n\n"]) : sseResponse(["event: done\ndata: {}\n\n"]))),
    );
    const { delays, sleep } = fastSleep();
    const { result } = renderHook(() => useEventStream(URL_, {}, { sleep }));
    await waitFor(() => expect(result.current.status).toBe("closed"));
    expect(delays).toEqual([1234]);
  });

  it("gives up after maxRetries", async () => {
    server.use(http.get(URL_, () => new HttpResponse(null, { status: 503 })));
    const { delays, sleep } = fastSleep();
    const { result } = renderHook(() => useEventStream(URL_, {}, { sleep, reconnect: { maxRetries: 3, random: () => 1 } }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(delays).toEqual([500, 1000, 2000]);
    expect(result.current.error).toBeInstanceOf(ApiError);
  });

  it("does not retry a 4xx, and redirects to login on 401", async () => {
    server.use(http.get(URL_, () => problemResponse(401, { title: "Unauthorized" })));
    const { delays, sleep } = fastSleep();
    const redirect = vi.fn();
    const { result } = renderHook(() => useEventStream(URL_, {}, { sleep, redirect }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(delays).toEqual([]);
    expect(redirect).toHaveBeenCalledWith("/auth/login?next=%2F");
    expect((result.current.error as ApiError).status).toBe(401);
  });

  it("aborts the request on unmount and stops reconnecting", async () => {
    let opened = 0;
    server.use(
      http.get(URL_, () => {
        opened++;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode("data: 1\n\n"));
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    const { signals, fetch } = spyFetch();
    const got: unknown[] = [];
    const { result, unmount } = renderHook(() => useEventStream<{ message: number }>(URL_, { message: (d) => got.push(d) }, { fetch }));
    await waitFor(() => expect(got).toEqual([1]));
    expect(result.current.status).toBe("open");
    expect(signals[0]?.aborted).toBe(false);
    unmount();
    expect(signals[0]?.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(opened).toBe(1);
  });

  it("close() aborts and marks the stream closed", async () => {
    server.use(
      http.get(URL_, () => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode("data: 1\n\n"));
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    const { result } = renderHook(() => useEventStream(URL_, {}));
    await waitFor(() => expect(result.current.status).toBe("open"));
    act(() => result.current.close());
    expect(result.current.status).toBe("closed");
  });

  it("does not connect when url is null", () => {
    const { result } = renderHook(() => useEventStream(null, {}));
    expect(result.current.status).toBe("idle");
  });
});

describe("useEventStream (POST + send)", () => {
  const POST_URL = "http://localhost:3000/api/assistant/conversations/c1/messages";

  it("POSTs the JSON body and streams the SSE response; no automatic connect", async () => {
    const requests: { method: string; body: unknown; ct: string | null; accept: string | null }[] = [];
    server.use(
      http.post(POST_URL, async ({ request }) => {
        requests.push({ method: request.method, body: await request.json(), ct: request.headers.get("content-type"), accept: request.headers.get("accept") });
        return sseResponse(['event: text\ndata: {"text":"Hi"}\n\n', 'event: tool_result\ndata: {"id":"1","content":"ok"}\n\nevent: done\ndata: {}\n\n']);
      }),
    );
    const seen: string[] = [];
    const { result } = renderHook(() =>
      useEventStream<AssistantEvents>(
        POST_URL,
        { text: (d) => seen.push(d.text), tool_result: (d) => seen.push(`result:${d.id}`), done: () => seen.push("done") },
        { method: "POST" },
      ),
    );
    expect(result.current.status).toBe("idle");
    expect(requests).toHaveLength(0);
    await act(async () => {
      await result.current.send({ content: "hello" });
    });
    expect(requests).toEqual([{ method: "POST", body: { content: "hello" }, ct: "application/json", accept: "text/event-stream" }]);
    expect(seen).toEqual(["Hi", "result:1", "done"]);
    expect(result.current.status).toBe("closed");
  });

  it("never replays a POST after a dropped stream by default", async () => {
    let n = 0;
    server.use(http.post(POST_URL, () => (++n, sseResponse(["event: text\ndata: {\"text\":\"a\"}\n\n"]))));
    const { result } = renderHook(() => useEventStream<AssistantEvents>(POST_URL, {}, { method: "POST" }));
    await act(async () => {
      await result.current.send({ content: "x" });
    });
    expect(n).toBe(1);
    expect(result.current.status).toBe("closed");
  });

  it("a second send aborts the first", async () => {
    server.use(
      http.post(POST_URL, () => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode("data: 1\n\n"));
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    const { signals, fetch } = spyFetch();
    const { result } = renderHook(() => useEventStream(POST_URL, {}, { method: "POST", fetch }));
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.send({ n: 1 });
      await waitFor(() => expect(signals).toHaveLength(1));
      void result.current.send({ n: 2 });
    });
    await first;
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    act(() => result.current.close());
    expect(signals[1]?.aborted).toBe(true);
  });

  it("surfaces a problem+json failure of the POST as error", async () => {
    server.use(http.post(POST_URL, () => problemResponse(422, { title: "Unprocessable Entity", errors: [{ location: "body.content", message: "required" }] })));
    const { result } = renderHook(() => useEventStream(POST_URL, {}, { method: "POST" }));
    await act(async () => {
      await result.current.send({});
    });
    expect(result.current.status).toBe("error");
    expect((result.current.error as ApiError).fieldErrors).toEqual({ "body.content": "required" });
  });
});
