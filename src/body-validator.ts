import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/** A JSON Schema object (OpenAPI 3.1 dialect, as Huma emits). */
export type JsonSchema = { [key: string]: unknown };

/** Minimal view of an OpenAPI document; the generated spec JSON satisfies it. */
export interface OpenApiDocument {
  paths?: { [path: string]: { [method: string]: unknown } | undefined };
  components?: { [key: string]: unknown };
}

/** Field errors keyed like `ApiError.fieldErrors`: `body.title`, `body.tags[0]`, `body`. */
export type FieldErrors = Record<string, string>;

export interface BodyValidator<T = unknown> {
  /** Returns `{}` when the value is acceptable to the API, else one message per location. */
  validate(values: unknown): FieldErrors;
  /** Type guard form of `validate`. */
  isValid(values: unknown): values is T;
  readonly schema: JsonSchema;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const JSON_MEDIA = /^application\/(.+\+)?json/;

/** Finds the JSON request body schema of an operation by `operationId`. Throws when missing. */
export function findBodySchema(doc: OpenApiDocument, operationId: string): JsonSchema {
  for (const item of Object.values(doc.paths ?? {})) {
    for (const op of Object.values(item ?? {})) {
      if (!isRecord(op) || op.operationId !== operationId) continue;
      const body = op.requestBody;
      if (isRecord(body) && isRecord(body.content)) {
        for (const [media, entry] of Object.entries(body.content)) {
          if (JSON_MEDIA.test(media) && isRecord(entry) && isRecord(entry.schema)) {
            return entry.schema;
          }
        }
      }
      throw new Error(`Operation "${operationId}" has no JSON request body`);
    }
  }
  throw new Error(`Operation "${operationId}" not found in the OpenAPI document`);
}

function pointerToLocation(instancePath: string): string {
  let out = "body";
  for (const raw of instancePath.split("/").slice(1)) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    out += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`;
  }
  return out;
}

function toLocation(e: ErrorObject): { location: string; message: string } {
  const base = pointerToLocation(e.instancePath);
  switch (e.keyword) {
    case "required": {
      const p = String((e.params as { missingProperty?: unknown }).missingProperty);
      return { location: `${base}.${p}`, message: `expected required property ${p} to be present` };
    }
    case "additionalProperties": {
      const p = String((e.params as { additionalProperty?: unknown }).additionalProperty);
      return { location: `${base}.${p}`, message: `unexpected property ${p}` };
    }
    default:
      return { location: base, message: e.message ?? "invalid" };
  }
}

/**
 * Builds a validator for a request body.
 *
 * - `createBodyValidator(doc, "createItem")`: takes the OpenAPI document and an operation id.
 * - `createBodyValidator(schema)`: takes a schema object; `$ref`s into `#/components` need the `components` key, so pass a doc for those.
 *
 * Ajv (2020-12 dialect, `ajv-formats`, all errors) does the checking, so the form rejects what Huma would reject.
 */
export function createBodyValidator<T = unknown>(spec: OpenApiDocument | JsonSchema, operationId?: string): BodyValidator<T> {
  let schema: JsonSchema;
  if (operationId !== undefined) {
    const doc = spec as OpenApiDocument;
    schema = { ...findBodySchema(doc, operationId), components: doc.components ?? {} };
  } else {
    schema = spec as JsonSchema;
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const check: ValidateFunction = ajv.compile(schema);
  return {
    schema,
    validate(values) {
      if (check(values)) return {};
      const out: FieldErrors = {};
      for (const e of check.errors ?? []) {
        const { location, message } = toLocation(e);
        if (!(location in out)) out[location] = message;
      }
      return out;
    },
    isValid(values): values is T {
      return check(values) === true;
    },
  };
}
