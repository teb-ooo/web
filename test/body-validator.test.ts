import { describe, expect, it, vi } from "vitest";
import { createBodyValidator } from "../src/body-validator.js";

const doc = {
  paths: {
    "/x": {
      post: {
        operationId: "make",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Body" } } } },
      },
    },
  },
  components: {
    schemas: {
      Body: {
        type: "object",
        additionalProperties: false,
        required: ["name", "kind"],
        properties: {
          $schema: { type: "string", format: "uri", readOnly: true },
          name: { type: "string", minLength: 3, maxLength: 8, pattern: "^[a-z0-9_]+$", patternDescription: "lowercase letters, digits and underscores" },
          kind: { type: "string", enum: ["a", "b"] },
          size: { type: "integer", minimum: 1, maximum: 5 },
          ratio: { type: "number", exclusiveMinimum: 0 },
          note: { type: ["string", "null"] },
          when: { type: "string", format: "date-time" },
          id: { type: "string", format: "uuid" },
          tags: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string", minLength: 2 } },
          inner: { $ref: "#/components/schemas/Inner" },
        },
      },
      Inner: { type: "object", required: ["k"], properties: { k: { type: "boolean" } } },
    },
  },
};
const v = createBodyValidator(doc, "make");

describe("interpreting body validator", () => {
  it("accepts a valid body", () => {
    expect(v.validate({ name: "milk_1", kind: "a", size: 3, ratio: 0.5, note: null, when: "2026-09-29T10:00:00Z", id: "60befda5-ab99-469f-b334-728ab6850db6", tags: ["ab"], inner: { k: true } })).toEqual({});
    expect(v.isValid({ name: "abc", kind: "b" })).toBe(true);
  });

  it("reports each constraint with Huma-style keys and messages", () => {
    const e = v.validate({ name: "AB", kind: "c", size: 9, ratio: 0, note: 1, when: "yesterday", id: "nope", tags: ["ab", "ab", "ab"], inner: { k: "x" }, extra: 1 });
    expect(Object.keys(e).sort()).toEqual(["body.extra", "body.id", "body.inner.k", "body.kind", "body.name", "body.note", "body.ratio", "body.size", "body.tags", "body.when"]);
    expect(e["body.size"]).toBe("expected number <= 5");
    expect(e["body.name"]).toBe("expected length >= 3");
    expect(e["body.extra"]).toBe("unexpected property extra");
  });

  it("indexes array items and reports the first problem per location", () => {
    expect(v.validate({ name: "abc", kind: "a", tags: ["ok", "x"] })).toEqual({ "body.tags[1]": "expected length >= 2" });
    expect(v.validate({ name: "ABCDEFGHIJ", kind: "a" })["body.name"]).toBe("expected length <= 8");
  });

  it("checks patterns with the server's description", () => {
    expect(v.validate({ name: "a-b", kind: "a" })["body.name"]).toBe("expected string to match lowercase letters, digits and underscores");
  });

  it("reports missing required properties and wrong types", () => {
    expect(v.validate({})).toEqual({ "body.name": "expected required property name to be present", "body.kind": "expected required property kind to be present" });
    expect(v.validate([])["body"]).toBe("must be object");
    expect(v.validate({ name: 5, kind: "a" })["body.name"]).toBe("must be string");
  });

  it("never generates code at runtime (the CSP forbids unsafe-eval)", () => {
    const fn = vi.spyOn(globalThis, "Function").mockImplementation(() => {
      throw new Error("Function constructor used");
    });
    try {
      expect(() => createBodyValidator(doc, "make").validate({ name: "abc", kind: "a" })).not.toThrow();
    } finally {
      fn.mockRestore();
    }
  });
});

describe("friendlyMessage", () => {
  it("turns schema wording into a sentence and leaves unknown text alone", async () => {
    const { friendlyMessage } = await import("../src/body-validator.js");
    expect(friendlyMessage("expected length >= 1")).toBe("Enter a value.");
    expect(friendlyMessage("expected length <= 20")).toBe("Use at most 20 characters.");
    expect(friendlyMessage("expected required property title to be present")).toBe("Required.");
    expect(friendlyMessage("expected string to be a valid email")).toBe("Enter a valid email address.");
    expect(friendlyMessage("expected string to match lowercase letters, digits and underscore")).toBe("Use lowercase letters, digits and underscore.");
    expect(friendlyMessage("expected string to match pattern ^a+$")).toBe("Use the expected format.");
    expect(friendlyMessage("something the server said")).toBe("something the server said");
  });
});
