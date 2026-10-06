import { afterEach, describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { redirectToLogin, setLoginPath } from "../src/request.js";
import { RequireAdmin, RequireUser, ForbiddenError, requireAdmin, requireUser } from "../src/guards.js";
import { HttpResponse, createTestQueryClient, http, problemResponse, setupMswServer } from "../src/testing.js";

const server = setupMswServer();
const ME = "http://localhost:3000/auth/me";
const admin = { subject: "s1", email: "a@x", username: "alex", groups: ["admin"], is_admin: true };
const plain = { ...admin, groups: [], is_admin: false };

const args = () => ({ context: { queryClient: createTestQueryClient() }, location: { href: "/admin/users?page=2" } });

async function thrown(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe("route guards", () => {
  it("RequireUser returns the user into context when signed in", async () => {
    server.use(http.get(ME, () => HttpResponse.json(plain)));
    expect(await RequireUser(args())).toEqual({ user: plain });
  });

  it("requireUser sends the document to /auth/login?next= when signed out, and never resolves", async () => {
    server.use(http.get(ME, () => problemResponse(401)));
    const urls: string[] = [];
    let settled = false;
    void requireUser({ redirect: (u) => urls.push(u) })(args()).then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(urls).toEqual(["/auth/login?next=%2Fadmin%2Fusers%3Fpage%3D2"]);
    expect(settled).toBe(false); // not a router redirect: a router `href` redirect is a client-side navigation
  });

  it("requireUser honours loginPath", async () => {
    server.use(http.get(ME, () => problemResponse(401)));
    const urls: string[] = [];
    void requireUser({ loginPath: "/sso", redirect: (u) => urls.push(u) })(args());
    await new Promise((r) => setTimeout(r, 50));
    expect(urls).toEqual(["/sso?next=%2Fadmin%2Fusers%3Fpage%3D2"]);
  });

  it("RequireAdmin passes admins", async () => {
    server.use(http.get(ME, () => HttpResponse.json(admin)));
    expect((await RequireAdmin(args())).user.is_admin).toBe(true);
  });

  it("RequireAdmin sends signed-out users to login", async () => {
    server.use(http.get(ME, () => problemResponse(401)));
    const urls: string[] = [];
    void requireAdmin({ redirect: (u) => urls.push(u) })(args());
    await new Promise((r) => setTimeout(r, 50));
    expect(urls).toEqual(["/auth/login?next=%2Fadmin%2Fusers%3Fpage%3D2"]);
  });

  it("RequireAdmin throws a typed ForbiddenError for non-admins by default", async () => {
    server.use(http.get(ME, () => HttpResponse.json(plain)));
    const e = await thrown(RequireAdmin(args()));
    expect(e).toBeInstanceOf(ForbiddenError);
    expect((e as ForbiddenError).status).toBe(403);
  });

  it("requireAdmin({ redirectTo }) redirects non-admins", async () => {
    server.use(http.get(ME, () => HttpResponse.json(plain)));
    const e = await thrown(requireAdmin({ redirectTo: "/" })(args()));
    expect(isRedirect(e)).toBe(true);
    expect((e as { options: { to?: string } }).options.to).toBe("/");
  });

  it("uses the cached user: one /auth/me request for two guards", async () => {
    let hits = 0;
    server.use(
      http.get(ME, () => {
        hits++;
        return HttpResponse.json(admin);
      }),
    );
    const a = args();
    await RequireUser(a);
    await RequireAdmin(a);
    expect(hits).toBe(1);
  });
});

describe("setLoginPath (the app's own entrance page)", () => {
  afterEach(() => setLoginPath("/auth/login"));

  it("sends the guard and the 401 handler to the configured path, and not from the path itself", async () => {
    setLoginPath("/enter");
    server.use(http.get(ME, () => problemResponse(401)));
    const urls: string[] = [];
    void requireUser({ redirect: (u) => urls.push(u) })(args());
    await new Promise((r) => setTimeout(r, 50));
    expect(urls).toEqual(["/enter?next=%2Fadmin%2Fusers%3Fpage%3D2"]);
    redirectToLogin({ next: "/enter?next=%2F", redirect: (u) => urls.push(u) });
    redirectToLogin({ next: "/auth/login", redirect: (u) => urls.push(u) });
    expect(urls).toHaveLength(1);
  });
});
