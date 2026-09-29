import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createApi } from "../src/api.js";
import { isApiError } from "../src/api-error.js";
import { HttpResponse, createTestQueryClient, http, problemResponse, setupMswServer } from "../src/testing.js";
import type { paths } from "./fixtures/schema.js";
import { validationProblem } from "./fixtures/problem.js";

const server = setupMswServer();

function wrapper() {
  const qc = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

describe("createApi query bindings", () => {
  it("useQuery loads data with query params", async () => {
    let limit: string | null = null;
    server.use(
      http.get("http://localhost:3000/api/items", ({ request }) => {
        limit = new URL(request.url).searchParams.get("limit");
        return HttpResponse.json({ items: [{ id: "1", title: "milk", created_at: "x" }] });
      }),
    );
    const api = createApi<paths>();
    const { result } = renderHook(() => api.useQuery("get", "/api/items", { params: { query: { limit: 5 } } }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(limit).toBe("5");
    expect(result.current.data?.items[0]?.title).toBe("milk");
  });

  it("useQuery surfaces ApiError as error", async () => {
    server.use(http.get("http://localhost:3000/api/items/:id", () => problemResponse(404, { title: "Not Found", detail: "no such item" })));
    const api = createApi<paths>({ redirect: vi.fn() });
    const { result } = renderHook(() => api.useQuery("get", "/api/items/{id}", { params: { path: { id: "x" } } }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const err = result.current.error;
    expect(isApiError(err)).toBe(true);
    // Structurally satisfies the generated problem type: `title` is readable without narrowing.
    expect(err?.title).toBe("Not Found");
    if (isApiError(err)) expect(err.status).toBe(404);
  });

  it("useMutation posts a body and rejects with ApiError.fieldErrors", async () => {
    let body: unknown;
    server.use(
      http.post("http://localhost:3000/api/items", async ({ request }) => {
        body = await request.json();
        return (body as { title: string }).title.length < 3
          ? problemResponse(422, validationProblem)
          : HttpResponse.json({ id: "1", title: "milk", created_at: "x" }, { status: 201 });
      }),
    );
    const api = createApi<paths>();
    const { result } = renderHook(() => api.useMutation("post", "/api/items"), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ body: { title: "milk" } });
    });
    expect(body).toEqual({ title: "milk" });
    const err = await act(async () => result.current.mutateAsync({ body: { title: "ab" } }).catch((e: unknown) => e));
    expect(isApiError(err) && err.fieldErrors["body.title"]).toBe("expected length >= 3");
  });

  it("queryOptions works with queryClient.fetchQuery (route loaders)", async () => {
    server.use(http.get("http://localhost:3000/api/items", () => HttpResponse.json({ items: [] })));
    const api = createApi<paths>();
    const qc = createTestQueryClient();
    const data = await qc.fetchQuery(api.queryOptions("get", "/api/items"));
    expect(data).toEqual({ items: [] });
  });
});
