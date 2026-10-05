import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api-error.js";
import { platformFetch, throwIfNotOk } from "../src/request.js";

describe("platformFetch", () => {
  it("sends cookies, Accept JSON and a request id, and keeps a caller's header", async () => {
    const f = vi.fn(async () => new Response("{}"));
    await platformFetch("/x", { method: "POST", headers: { Accept: "text/plain" } }, { fetch: f as unknown as typeof fetch, requestId: () => "rid-1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/x");
    expect(init.credentials).toBe("include");
    const h = new Headers(init.headers);
    expect(h.get("X-Request-Id")).toBe("rid-1");
    expect(h.get("Accept")).toBe("text/plain");
    await platformFetch("/y", {}, { fetch: f as unknown as typeof fetch });
    expect(new Headers((f.mock.calls[1] as unknown as [string, RequestInit])[1].headers).get("Accept")).toBe("application/json");
  });

  it("throwIfNotOk turns its failure into an ApiError", async () => {
    const f = async () => new Response(JSON.stringify({ title: "Nope", status: 403, detail: "Not yours." }), { status: 403 });
    await expect(platformFetch("/z", {}, { fetch: f as unknown as typeof fetch }).then(throwIfNotOk)).rejects.toBeInstanceOf(ApiError);
  });
});
