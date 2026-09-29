import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { defaultBaseUrl, newRequestId, throwIfNotOk, REQUEST_ID_HEADER } from "./request.js";

/** Response of `GET /auth/me` (JSON snake_case, as sent by the Go `auth` package). */
export interface User {
  subject: string;
  email: string;
  username: string;
  picture?: string;
  groups: string[];
  is_admin: boolean;
}

export interface AuthOptions {
  /** Default: the page origin. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Default "/auth/me". */
  mePath?: string;
}

export const ME_QUERY_KEY = ["factory", "auth", "me"] as const;

/** Fetches the current user. 401 resolves to `null`; it never redirects. Other failures throw ApiError. */
export async function fetchUser(opts: AuthOptions = {}): Promise<User | null> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const url = new URL(opts.mePath ?? "/auth/me", opts.baseUrl ?? defaultBaseUrl());
  const res = await doFetch(url, {
    credentials: "include",
    headers: { Accept: "application/json", [REQUEST_ID_HEADER]: newRequestId() },
  });
  if (res.status === 401) return null;
  await throwIfNotOk(res);
  return (await res.json()) as User;
}

/** Query options for the current user: fetched once, cached forever (invalidate `ME_QUERY_KEY` after login/logout). */
export function userQueryOptions(opts: AuthOptions = {}) {
  return queryOptions({
    queryKey: ME_QUERY_KEY,
    queryFn: () => fetchUser(opts),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export interface UseUserResult {
  /** `null` when signed out (401) or while loading/failed. */
  user: User | null;
  isAdmin: boolean;
  isLoading: boolean;
  /** Set when `/auth/me` failed with something other than 401. */
  error: Error | null;
  refetch: () => Promise<unknown>;
}

export function useUser(opts: AuthOptions = {}): UseUserResult {
  const q = useQuery(userQueryOptions(opts));
  const user = q.data ?? null;
  return {
    user,
    isAdmin: user?.is_admin === true,
    isLoading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
  };
}

export function useIsAdmin(opts: AuthOptions = {}): { isAdmin: boolean; isLoading: boolean } {
  const { isAdmin, isLoading } = useUser(opts);
  return { isAdmin, isLoading };
}

/** Loader/guard helper: resolves the (cached) current user, `null` when signed out. */
export function ensureUser(queryClient: QueryClient, opts: AuthOptions = {}): Promise<User | null> {
  return queryClient.ensureQueryData(userQueryOptions(opts));
}
