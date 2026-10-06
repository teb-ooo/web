import { describe, expect, it, vi } from "vitest";
import { createApi } from "../src/api.js";
import { setLoginPath } from "../src/request.js";
import { ApiError, isApiError } from "../src/api-error.js";
import { HttpResponse, http, problemResponse, setupMswServer } from "../src/testing.js";
import type { paths } from "./fixtures/schema.js";
import { validationProblem } from "./fixtures/problem.js";

const server = setupMswServer();
const item = { id: "0198c4a0-0000-7000-8000-000000000001", title: "milk", created_at: "2026-09-29T06:30:00Z" };

describe("createApi", () => {
  it("sends credentials, a UUID X-Request-Id per request, and custom headers", async () => {
    const seen: { id: string | null; cred: RequestCredentials | undefined; custom: string | null }[] = [];
    const spy = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input as Request;
      seen.push({ id: req.headers.get("x-request-id"), cred: req.credentials, custom: req.headers.get("x-app") });
      return globalThis.fetch(input, init);
    };
    server.use(
      http.get("http://localhost:3000/api/items", ({ request }) => {
        expect(request.headers.get("x-request-id")).toBeTruthy();
        return HttpResponse.json({ items: [item] });
      }),
    );
    const api = createApi<paths>({ headers: { "X-App": "hello" }, fetch: spy });
    const a = await api.client.GET("/api/items");
    await api.client.GET("/api/items");
    expect(a.data?.items[0]?.title).toBe("milk");
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(s.cred).toBe("include");
      expect(s.custom).toBe("hello");
    }
    expect(seen[0]?.id).not.toBe(seen[1]?.id);
  });

  it("uses the injected request id generator", async () => {
    let id: string | null = null;
    server.use(
      http.get("http://localhost:3000/api/items", ({ request }) => {
        id = request.headers.get("x-request-id");
        return HttpResponse.json({ items: [] });
      }),
    );
    await createApi<paths>({ requestId: () => "req-1" }).client.GET("/api/items");
    expect(id).toBe("req-1");
  });

  it("maps problem+json to ApiError with fieldErrors keyed by location", async () => {
    server.use(http.post("http://localhost:3000/api/items", () => problemResponse(422, validationProblem)));
    const api = createApi<paths>();
    const err = await api.client.POST("/api/items", { body: { title: "ab" } }).catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    const e = err as ApiError;
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(422);
    expect(e.title).toBe("Unprocessable Entity");
    expect(e.detail).toBe("validation failed");
    expect(e.fieldErrors).toEqual({ "body.title": "expected length >= 3", "body.quantity": "expected number >= 1" });
    expect(e.errors).toHaveLength(3);
    expect(e.errors[0]?.value).toBe("ab");
  });

  it("tolerates non-JSON error bodies", async () => {
    server.use(http.get("http://localhost:3000/api/items", () => new HttpResponse("bad gateway", { status: 502, statusText: "Bad Gateway" })));
    const e = (await createApi<paths>().client.GET("/api/items").catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(502);
    expect(e.title).toBe("Bad Gateway");
    expect(e.fieldErrors).toEqual({});
  });

  it("redirects to /auth/login?next=<path+search> on 401 (then still throws)", async () => {
    server.use(http.get("http://localhost:3000/api/items", () => problemResponse(401, { title: "Unauthorized" })));
    window.history.pushState({}, "", "/items?tab=2&q=a b");
    const redirect = vi.fn();
    const err = (await createApi<paths>({ redirect }).client.GET("/api/items").catch((x: unknown) => x)) as ApiError;
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/auth/login?next=%2Fitems%3Ftab%3D2%26q%3Da%2520b");
    expect(err.status).toBe(401);
    window.history.pushState({}, "", "/");
  });

  it("sends a 401 to the path set with setLoginPath, unless the page is that path, and an option still wins", async () => {
    server.use(http.get("http://localhost:3000/api/items", () => problemResponse(401)));
    try {
      setLoginPath("/enter");
      window.history.pushState({}, "", "/items");
      const redirect = vi.fn();
      await createApi<paths>({ redirect }).client.GET("/api/items").catch(() => undefined);
      expect(redirect).toHaveBeenLastCalledWith("/enter?next=%2Fitems");
      await createApi<paths>({ redirect, loginPath: "/sso" }).client.GET("/api/items").catch(() => undefined);
      expect(redirect).toHaveBeenLastCalledWith("/sso?next=%2Fitems");
      window.history.pushState({}, "", "/enter");
      redirect.mockClear();
      await createApi<paths>({ redirect }).client.GET("/api/items").catch(() => undefined);
      expect(redirect).not.toHaveBeenCalled();
    } finally {
      setLoginPath("/auth/login");
      window.history.pushState({}, "", "/");
    }
  });

  it("does not redirect when disabled or already on an /auth/ page", async () => {
    server.use(http.get("http://localhost:3000/api/items", () => problemResponse(401)));
    const redirect = vi.fn();
    await createApi<paths>({ redirect, redirectOn401: false }).client.GET("/api/items").catch(() => undefined);
    window.history.pushState({}, "", "/auth/login");
    await createApi<paths>({ redirect }).client.GET("/api/items").catch(() => undefined);
    expect(redirect).not.toHaveBeenCalled();
    window.history.pushState({}, "", "/");
  });

  it("does not redirect on 403 or 500", async () => {
    server.use(http.get("http://localhost:3000/api/items", () => problemResponse(403)));
    const redirect = vi.fn();
    await createApi<paths>({ redirect }).client.GET("/api/items").catch(() => undefined);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("honours baseUrl", async () => {
    server.use(http.get("https://api.example.test/api/items", () => HttpResponse.json({ items: [] })));
    const r = await createApi<paths>({ baseUrl: "https://api.example.test" }).client.GET("/api/items");
    expect(r.data).toEqual({ items: [] });
  });
});

describe("ApiError.userMessage", () => {
  it("is a sentence for a person", async () => {
    const { ApiError } = await import("../src/api-error.js");
    expect(new ApiError({ status: 500, title: "Internal Server Error", detail: "internal error" }).userMessage).toBe("The server could not do that. Try again in a moment.");
    expect(new ApiError({ status: 422, title: "Unprocessable Entity", detail: "Rule text is too long." }).userMessage).toBe("Rule text is too long.");
    expect(new ApiError({ status: 403, title: "Forbidden" }).userMessage).toBe("You may not do this.");
    expect(new ApiError({ status: 403, title: "Forbidden", detail: "Only the platform agent applies a proposal." }).userMessage).toBe("Only the platform agent applies a proposal.");
    expect(new ApiError({ status: 404, title: "Not Found" }).userMessage).toBe("Not found.");
    expect(new ApiError({ status: 409, title: "Conflict" }).userMessage).toBe("Conflict");
  });
});
