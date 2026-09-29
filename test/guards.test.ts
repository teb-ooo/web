import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
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

  it("RequireUser redirects to /auth/login?next= when signed out", async () => {
    server.use(http.get(ME, () => problemResponse(401)));
    const e = await thrown(RequireUser(args()));
    expect(isRedirect(e)).toBe(true);
    expect((e as { options: { href?: string } }).options.href).toBe("/auth/login?next=%2Fadmin%2Fusers%3Fpage%3D2");
  });

  it("requireUser honours loginPath", async () => {
    server.use(http.get(ME, () => problemResponse(401)));
    const e = await thrown(requireUser({ loginPath: "/sso" })(args()));
    expect((e as { options: { href?: string } }).options.href).toBe("/sso?next=%2Fadmin%2Fusers%3Fpage%3D2");
  });

  it("RequireAdmin passes admins", async () => {
    server.use(http.get(ME, () => HttpResponse.json(admin)));
    expect((await RequireAdmin(args())).user.is_admin).toBe(true);
  });

  it("RequireAdmin sends signed-out users to login", async () => {
    server.use(http.get(ME, () => problemResponse(401)));
    expect(isRedirect(await thrown(RequireAdmin(args())))).toBe(true);
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
