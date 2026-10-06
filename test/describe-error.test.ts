import { describe, expect, it } from "vitest";
import { ApiError, describeError } from "../src/index.js";

describe("describeError", () => {
  it("says an ApiError's userMessage: the 4xx detail, a plain sentence for a 5xx", () => {
    expect(describeError(ApiError.fromProblem(409, { title: "Conflict", status: 409, detail: "That name is taken." }))).toBe("That name is taken.");
    expect(describeError(ApiError.fromProblem(500, { title: "Boom", status: 500, detail: "stack trace" }))).toBe("The server could not do that. Try again in a moment.");
  });
  it("reads a problem document the generated client returns", () => {
    expect(describeError({ title: "Forbidden", detail: "Only admins." })).toBe("Only admins.");
    expect(describeError({ title: "Forbidden" })).toBe("Forbidden");
  });
  it("names a network failure and never shows a thrown Error's own message", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toContain("could not be reached");
    expect(describeError(new Error("audio: HTTP 401"))).toBe("Something went wrong. Try again.");
    expect(describeError(undefined)).toBe("Something went wrong. Try again.");
  });
});
