import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ApiError } from "../src/api-error.js";
import { createBodyValidator, findBodySchema } from "../src/body-validator.js";
import { useForm } from "../src/use-form.js";
import spec from "./fixtures/openapi.json";
import { validationProblem } from "./fixtures/problem.js";

interface CreateItem extends Record<string, unknown> {
  title: string;
  quantity?: number;
  contact_email?: string;
  tags?: string[];
}

const validator = createBodyValidator<CreateItem>(spec, "createItem");

describe("createBodyValidator", () => {
  it("finds the request body schema by operation id", () => {
    expect(findBodySchema(spec, "createItem")).toEqual({ $ref: "#/components/schemas/CreateItemBody" });
    expect(() => findBodySchema(spec, "listItems")).toThrow(/no JSON request body/);
    expect(() => findBodySchema(spec, "nope")).toThrow(/not found/);
  });

  it("accepts what the API accepts", () => {
    expect(validator.validate({ title: "milk" })).toEqual({});
    expect(validator.validate({ title: "milk", quantity: 2, contact_email: "a@b.co", tags: ["ab", "cd"] })).toEqual({});
    expect(validator.isValid({ title: "milk" })).toBe(true);
  });

  it("rejects what the API rejects, with Huma-style keys", () => {
    const errs = validator.validate({ title: "ab", quantity: 0, contact_email: "nope", tags: ["ok", "x"], extra: 1 });
    expect(Object.keys(errs).sort()).toEqual(["body.contact_email", "body.extra", "body.quantity", "body.tags[1]", "body.title"]);
    expect(validator.isValid({ title: "ab" })).toBe(false);
  });

  it("reports missing required properties at body.<name>", () => {
    expect(validator.validate({})).toEqual({ "body.title": "expected required property title to be present" });
  });

  it("flags wrong types", () => {
    expect(validator.validate({ title: 3 })["body.title"]).toMatch(/string/);
    expect(validator.validate("x")["body"]).toMatch(/object/);
  });

  it("works from a bare schema object too", () => {
    const v = createBodyValidator({ type: "object", required: ["a"], properties: { a: { type: "integer" } } });
    expect(v.validate({ a: 1.5 })).toHaveProperty("body.a");
    expect(v.validate({ a: 1 })).toEqual({});
  });

  it("uses the same keys ApiError.fieldErrors would have", () => {
    const server = ApiError.fromProblem(422, validationProblem).fieldErrors;
    const client = validator.validate({ title: "ab", quantity: 0 });
    expect(Object.keys(client).sort()).toEqual(Object.keys(server).sort());
  });
});

describe("useForm", () => {
  it("blocks submit while invalid, shows errors after a submit attempt, submits when valid", async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useForm(validator, { defaultValues: { title: "" } as CreateItem, onSubmit }));
    expect(result.current.isValid).toBe(false);
    expect(result.current.field("title").error).toBeUndefined(); // pristine: no noise
    expect(result.current.errors).toHaveProperty("body.title");

    await act(() => result.current.handleSubmit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.field("title").error).toBeDefined();

    act(() => result.current.field("title").onChange("milk"));
    expect(result.current.values.title).toBe("milk");
    expect(result.current.isValid).toBe(true);
    expect(result.current.field("title").error).toBeUndefined();

    await act(() => result.current.handleSubmit());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ title: "milk" });
  });

  it("shows a field error after blur", () => {
    const { result } = renderHook(() => useForm(validator, { defaultValues: { title: "ab" } as CreateItem, onSubmit: vi.fn() }));
    expect(result.current.fieldError("title")).toBeUndefined();
    act(() => result.current.field("title").onBlur());
    expect(result.current.fieldError("title")).toMatch(/at least 3|fewer than 3|3 characters/);
    expect(result.current.errors["body.title"]).toBeDefined();
  });

  it("handles nested/array paths", () => {
    const { result } = renderHook(() => useForm(validator, { defaultValues: { title: "milk", tags: ["ok", "x"] } as CreateItem, onSubmit: vi.fn() }));
    expect(Object.keys(result.current.errors)).toEqual(["body.tags[1]"]);
    act(() => result.current.setValue("tags[1]", "xx"));
    expect(result.current.isValid).toBe(true);
  });

  it("maps a server ApiError thrown by onSubmit into errors with the same keys, cleared on edit", async () => {
    const onSubmit = vi.fn().mockRejectedValue(ApiError.fromProblem(422, validationProblem));
    const { result } = renderHook(() => useForm(validator, { defaultValues: { title: "milk" } as CreateItem, onSubmit }));
    await act(() => result.current.handleSubmit());
    expect(result.current.errors["body.title"]).toBe("expected length >= 3");
    expect(result.current.errors["body.quantity"]).toBe("expected number >= 1");
    expect(result.current.fieldError("title")).toBe("expected length >= 3");
    act(() => result.current.setValue("title", "milky"));
    expect(result.current.fieldError("title")).toBeUndefined();
    expect(result.current.errors["body.quantity"]).toBe("expected number >= 1");
  });

  it("rethrows non-ApiError failures from onSubmit", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useForm(validator, { defaultValues: { title: "milk" } as CreateItem, onSubmit }));
    await expect(act(() => result.current.handleSubmit())).rejects.toThrow("boom");
  });

  it("reset restores defaults and clears server errors", async () => {
    const { result } = renderHook(() => useForm(validator, { defaultValues: { title: "milk" } as CreateItem, onSubmit: vi.fn() }));
    act(() => result.current.setValue("title", "other"));
    act(() => result.current.setServerErrors({ "body.title": "taken" }));
    expect(result.current.errors["body.title"]).toBe("taken");
    act(() => result.current.reset());
    expect(result.current.values.title).toBe("milk");
    expect(result.current.errors["body.title"]).toBeUndefined();
  });
});
