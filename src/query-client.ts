import { QueryClient } from "@tanstack/react-query";
import { shouldRetry } from "./api.js";

/** A QueryClient with playground defaults: no retry on 4xx ApiErrors, no refetch on window focus, 30 s staleness. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false, staleTime: 30_000 },
    },
  });
}
