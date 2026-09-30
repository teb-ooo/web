import { describe, expectTypeOf, it } from "vitest";
import { createApi } from "../src/api.js";
import { isApiError, type ApiError } from "../src/api-error.js";
import type { components, paths } from "./fixtures/schema.js";

type Item = components["schemas"]["Item"];

describe("createApi<paths> infers from the generated schema", () => {
  const api = createApi<paths>();

  it("query data is typed from the response schema", () => {
    const q = api.useQuery("get", "/api/items");
    expectTypeOf(q.data).toEqualTypeOf<{ items: Item[] } | undefined>();
    const one = api.useQuery("get", "/api/items/{id}", { params: { path: { id: "x" } } });
    expectTypeOf(one.data).toEqualTypeOf<Item | undefined>();
  });

  it("mutation variables are typed from the request body", () => {
    const m = api.useMutation("post", "/api/items");
    expectTypeOf<{ body: components["schemas"]["CreateItemBody"] }>().toExtend<Parameters<typeof m.mutateAsync>[0]>();
    expectTypeOf<{ body: { title: number } }>().not.toExtend<Parameters<typeof m.mutateAsync>[0]>();
    expectTypeOf(m.data).toEqualTypeOf<Item | undefined>();
  });

  it("rejects unknown paths, methods and bad bodies", () => {
    // @ts-expect-error unknown path
    api.useQuery("get", "/api/nope");
    // @ts-expect-error path exists but not for delete
    api.useMutation("delete", "/api/items");
    // @ts-expect-error missing required path param
    api.useQuery("get", "/api/items/{id}");
    void api.client.POST("/api/items", {
      // @ts-expect-error title must be a string
      body: { title: 3 },
    });
  });

  it("raw client is typed", async () => {
    const r = await api.client.GET("/api/items");
    expectTypeOf(r.data).toEqualTypeOf<{ items: Item[] } | undefined>();
  });

  it("error narrows to ApiError", () => {
    const e: unknown = null;
    if (isApiError(e)) expectTypeOf(e).toEqualTypeOf<ApiError>();
  });
});

// AssistantEvents mirrors the Go assistant SSE events (playground-go assistant.go): exactly these five names.
import type { AssistantEvents } from "../src/index";
expectTypeOf<keyof AssistantEvents>().toEqualTypeOf<"text" | "tool_call" | "tool_result" | "done" | "error">();
expectTypeOf<AssistantEvents["error"]>().toEqualTypeOf<{ detail: string }>();
