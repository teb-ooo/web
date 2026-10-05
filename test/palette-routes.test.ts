import { describe, expect, it } from "vitest";
import { paletteRouteProblems } from "../src/testing";

const spec = {
  paths: {
    "/api/rules/{code}": { delete: { operationId: "retire-rule", "x-palette": { title: "Retire", group: "Rule", when: { route: "/rule/$code" } } } },
    "/api/people/{id}/disable": { post: { operationId: "disable-person", "x-palette": { title: "Disable", group: "P", when: { route: "/users", needs: "selection" } } } },
    "/api/ping": { post: { operationId: "ping", "x-palette": false } },
    "/api/x": { post: { operationId: "x", "x-palette": { title: "X", group: "G" } } },
  },
};

describe("paletteRouteProblems", () => {
  it("is empty when every when.route is a route of the app, and ignores tags with no route", () => {
    expect(paletteRouteProblems(spec, ["/", "/rule/$code", "/users"])).toEqual([]);
  });
  it("names a tag whose route matches nothing", () => {
    const p = paletteRouteProblems(spec, ["/", "/rule/$code", "/people"]);
    expect(p).toEqual(['POST /api/people/{id}/disable (disable-person): x-palette.when.route "/users" matches no route']);
  });
});
