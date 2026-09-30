import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { ensureUser, type AuthOptions, type User } from "./auth.js";
import { DEFAULT_LOGIN_PATH, defaultRedirect, loginUrl, type RedirectFn } from "./request.js";

/** Thrown by `RequireAdmin` for a signed-in non-admin when no `redirectTo` is configured. */
export class ForbiddenError extends Error {
  override readonly name = "ForbiddenError";
  readonly status = 403;
  constructor(message = "Admin access required") {
    super(message);
  }
}

export function isForbiddenError(e: unknown): e is ForbiddenError {
  return e instanceof ForbiddenError;
}

/** The subset of TanStack Router's `beforeLoad` argument the guards use. Router context must carry `queryClient`. */
export interface GuardArgs {
  context: { queryClient: QueryClient };
  location: { href: string };
}

export interface GuardOptions extends AuthOptions {
  loginPath?: string;
  /** How the browser is sent to the login page: a full document load (default `window.location.assign`). */
  redirect?: RedirectFn;
}

export interface AdminGuardOptions extends GuardOptions {
  /** Signed-in non-admins are redirected here. Without it, a `ForbiddenError` is thrown. */
  redirectTo?: string;
}

/** Guard playground. Returns a `beforeLoad` function that resolves the user, or navigates the document to the login page. */
export function requireUser(opts: GuardOptions = {}) {
  return async ({ context, location }: GuardArgs): Promise<{ user: User }> => {
    const user = await ensureUser(context.queryClient, opts);
    if (!user) {
      // The login page is served by the Go app, not a client route, and TanStack Router treats a same-origin
      // `href` as a client-side navigation (the SPA would land on a not-found page). So load the document, and
      // never resolve: the page is going away, and the route must not render or load anything meanwhile.
      (opts.redirect ?? defaultRedirect)(loginUrl(location.href, opts.loginPath ?? DEFAULT_LOGIN_PATH));
      return new Promise<never>(() => undefined);
    }
    return { user };
  };
}

/** Guard playground for admin-only routes. */
export function requireAdmin(opts: AdminGuardOptions = {}) {
  const needUser = requireUser(opts);
  return async (args: GuardArgs): Promise<{ user: User }> => {
    const { user } = await needUser(args);
    if (!user.is_admin) {
      if (opts.redirectTo !== undefined) throw redirect({ to: opts.redirectTo });
      throw new ForbiddenError();
    }
    return { user };
  };
}

/** `beforeLoad: RequireUser` (router context must provide `queryClient`). Adds `user` to the route context. */
export const RequireUser = requireUser();

/** `beforeLoad: RequireAdmin`. Throws `ForbiddenError` for non-admins; use `requireAdmin({ redirectTo })` to redirect. */
export const RequireAdmin = requireAdmin();
