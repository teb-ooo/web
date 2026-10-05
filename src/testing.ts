import { createElement, type ReactElement, type ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer, type SetupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import type { PlaygroundRaw } from "./playground.js";

export { http, HttpResponse, delay } from "msw";

/** Sets `window.__PLAYGROUND__` (snake_case, as the Go spa package delivers it). */
export function setPlayground(raw: PlaygroundRaw = {}): void {
  window.__PLAYGROUND__ = { ...raw };
}

export function resetPlayground(): void {
  delete window.__PLAYGROUND__;
}

/** A QueryClient that never retries and never caches between tests. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

export interface RenderWithProvidersOptions {
  queryClient?: QueryClient;
  /** Fake `window.__PLAYGROUND__` for the render. */
  playground?: PlaygroundRaw;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = options.queryClient ?? createTestQueryClient();
  if (options.playground) setPlayground(options.playground);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  return Object.assign(render(ui, { wrapper }), { queryClient });
}

/** Starts an msw server for the current test file: listen before all, reset after each, close after all. */
export function setupMswServer(...handlers: Parameters<typeof setupServer>): SetupServer {
  const server = setupServer(...handlers);
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}

/** A `text/event-stream` Response delivering each chunk as its own read (chunks may split events anywhere). */
export function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const c = chunks[i++];
      if (c === undefined) return controller.close();
      await Promise.resolve();
      controller.enqueue(enc.encode(c));
    },
  });
  return new Response(body, { ...init, headers: { "Content-Type": "text/event-stream", ...init.headers } });
}

/** RFC 9457 problem+json Response, like Huma sends. */
export function problemResponse(status: number, problem: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ title: "Error", status, ...problem }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

interface PaletteDoc {
  paths?: Record<string, Record<string, { operationId?: string; "x-palette"?: unknown } | undefined> | undefined>;
}

/**
 * The `x-palette` tags (decision 0004, `PaletteFromApi` in `@teb-ooo/ui/cmdk`) whose `when.route` matches no route of the
 * app: a tag that can never show because the route was renamed. Pass the OpenAPI document and the router's route patterns,
 * for example `Object.keys(router.routesByPath)` (patterns such as `/rule/$code`). One line per problem; assert it is empty.
 */
export function paletteRouteProblems(spec: PaletteDoc, routePatterns: readonly string[]): string[] {
  const known = new Set(routePatterns);
  const out: string[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) {
      const tag = op?.["x-palette"];
      const route = typeof tag === "object" && tag !== null && "when" in tag ? (tag as { when?: { route?: unknown } }).when?.route : undefined;
      if (typeof route === "string" && !known.has(route)) {
        out.push(`${method.toUpperCase()} ${path} (${op?.operationId ?? "no operationId"}): x-palette.when.route "${route}" matches no route`);
      }
    }
  }
  return out;
}
