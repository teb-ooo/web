import { createElement, type ReactElement, type ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer, type SetupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import type { FactoryRaw } from "./factory.js";

export { http, HttpResponse, delay } from "msw";

/** Sets `window.__FACTORY__` (snake_case, as the Go spa package delivers it). Merges over defaults `{}`. */
export function setFactory(raw: FactoryRaw = {}): void {
  window.__FACTORY__ = { ...raw };
}

export function resetFactory(): void {
  delete window.__FACTORY__;
}

/** A QueryClient that never retries and never caches between tests. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

export interface RenderWithProvidersOptions {
  queryClient?: QueryClient;
  /** Fake `window.__FACTORY__` for the render. */
  factory?: FactoryRaw;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = options.queryClient ?? createTestQueryClient();
  if (options.factory) setFactory(options.factory);
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
