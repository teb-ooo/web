import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { useIsAdmin, useUser } from "../src/auth.js";
import { HttpResponse, http, problemResponse, renderWithProviders, setupMswServer } from "../src/testing.js";

const server = setupMswServer();
const ME = "http://localhost:3000/auth/me";
const admin = { subject: "s1", email: "a@teb.ooo", username: "alex", picture: "https://x/y.png", groups: ["admin"], is_admin: true };
const plain = { ...admin, subject: "s2", groups: [], is_admin: false };

function Probe() {
  const { user, isAdmin, isLoading } = useUser();
  return createElement("div", { "data-testid": "out" }, isLoading ? "loading" : `${user?.username ?? "anon"}|${String(isAdmin)}`);
}

describe("useUser / useIsAdmin", () => {
  it("returns the user and isAdmin on 200", async () => {
    server.use(http.get(ME, () => HttpResponse.json(admin)));
    renderWithProviders(createElement(Probe));
    expect(screen.getByTestId("out").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("alex|true"));
  });

  it("isAdmin is false for non-admins", async () => {
    server.use(http.get(ME, () => HttpResponse.json(plain)));
    renderWithProviders(createElement(Probe));
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("alex|false"));
  });

  it("treats 401 as user: null and does not redirect", async () => {
    server.use(http.get(ME, () => problemResponse(401)));
    renderWithProviders(createElement(Probe));
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("anon|false"));
    expect(window.location.pathname).toBe("/");
  });

  it("reads /auth/me once across many consumers and re-renders", async () => {
    let hits = 0;
    let credentials: string | null = null;
    server.use(
      http.get(ME, ({ request }) => {
        hits++;
        credentials = request.headers.get("x-request-id");
        return HttpResponse.json(admin);
      }),
    );
    function Two() {
      const a = useIsAdmin();
      return createElement("div", null, createElement(Probe), createElement("span", { "data-testid": "adm" }, String(a.isAdmin)));
    }
    const { rerender } = renderWithProviders(createElement(Two));
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("alex|true"));
    rerender(createElement(Two));
    rerender(createElement(Two));
    expect(screen.getByTestId("adm").textContent).toBe("true");
    expect(hits).toBe(1);
    expect(credentials).toBeTruthy();
  });

  it("exposes non-401 failures as error, with user null", async () => {
    server.use(http.get(ME, () => problemResponse(500, { title: "Internal Server Error" })));
    function E() {
      const { user, error, isLoading } = useUser();
      return createElement("div", { "data-testid": "out" }, isLoading ? "loading" : `${String(user)}|${error?.message ?? ""}`);
    }
    renderWithProviders(createElement(E));
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("null|Internal Server Error"));
  });
});
