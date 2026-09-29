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

function pointerToLocation(path: string[]): string {
  let out = "body";
  for (const seg of path) out += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`;
  return out;
}

/*
 * An interpreting validator for the JSON Schema subset Huma emits (OpenAPI 3.1 request bodies). It never compiles
 * code (`new Function`/`eval`), because the factory's CSP forbids 'unsafe-eval' (ADR 0077). Messages follow Huma's
 * ("expected length >= 3", "expected number >= 1") and keys are `body.field`, `body.tags[1]`, `body`.
 */
type Schema = { [key: string]: unknown };

const FORMATS: Record<string, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  "date-time": /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/,
  uri: /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/,
  "uri-reference": /^[^\s]*$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  hostname: /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/,
  ipv4: /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/,
};

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(want: string, v: unknown): boolean {
  const got = typeOf(v);
  return want === got || (want === "number" && got === "integer");
}

function resolveRef(root: Schema, ref: string): Schema | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(cur)) return undefined;
    cur = cur[seg];
  }
  return isRecord(cur) ? cur : undefined;
}

function check(root: Schema, schema: Schema, value: unknown, path: string[], out: FieldErrors, depth = 0): void {
  if (depth > 64) return;
  const fail = (message: string, extra?: string): void => {
    const location = extra === undefined ? pointerToLocation(path) : pointerToLocation([...path, extra]);
    if (!(location in out)) out[location] = message;
  };
  if (typeof schema.$ref === "string") {
    const target = resolveRef(root, schema.$ref);
    if (target) check(root, target, value, path, out, depth + 1);
  }
  if (Array.isArray(schema.allOf)) for (const s of schema.allOf) if (isRecord(s)) check(root, s, value, path, out, depth + 1);
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const alts = (Array.isArray(schema.anyOf) ? schema.anyOf : (schema.oneOf as unknown[])).filter(isRecord);
    const ok = alts.some((s) => {
      const e: FieldErrors = {};
      check(root, s, value, path, e, depth + 1);
      return Object.keys(e).length === 0;
    });
    if (alts.length > 0 && !ok) fail("must match one of the allowed shapes");
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) fail(`expected value to be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    fail(`expected value to be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? (schema.type as string[]) : [String(schema.type)];
  const nullable = schema.nullable === true;
  if (types.length > 0) {
    if (value === null && nullable) return;
    if (!types.some((t) => typeMatches(t, value))) {
      fail(`must be ${types.join(" or ")}`);
      return;
    }
  }
  if (typeof value === "string") {
    const len = [...value].length;
    if (typeof schema.minLength === "number" && len < schema.minLength) fail(`expected length >= ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && len > schema.maxLength) fail(`expected length <= ${schema.maxLength}`);
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) fail(typeof schema.patternDescription === "string" ? `expected string to match ${schema.patternDescription}` : `expected string to match pattern ${schema.pattern}`);
      } catch {
        /* a pattern JavaScript cannot parse is left to the server */
      }
    }
    if (typeof schema.format === "string") {
      const re = FORMATS[schema.format];
      if (re && !re.test(value)) fail(`expected string to be a valid ${schema.format}`);
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) fail(`expected number >= ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) fail(`expected number <= ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) fail(`expected number > ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) fail(`expected number < ${schema.exclusiveMaximum}`);
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0 && value % schema.multipleOf !== 0) fail(`expected number to be a multiple of ${schema.multipleOf}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) fail(`expected array length >= ${schema.minItems}`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) fail(`expected array length <= ${schema.maxItems}`);
    if (schema.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail("expected array items to be unique");
    if (isRecord(schema.items)) value.forEach((item, i) => check(root, schema.items as Schema, item, [...path, String(i)], out, depth + 1));
  }
  if (isRecord(value)) {
    const props = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const name of schema.required) {
        if (typeof name === "string" && !(name in value)) fail(`expected required property ${name} to be present`, name);
      }
    }
    for (const [k, v] of Object.entries(value)) {
      const sub = props[k];
      if (isRecord(sub)) check(root, sub, v, [...path, k], out, depth + 1);
      else if (schema.additionalProperties === false) fail(`unexpected property ${k}`, k);
      else if (isRecord(schema.additionalProperties)) check(root, schema.additionalProperties, v, [...path, k], out, depth + 1);
    }
  }
}

/**
 * Builds a validator for a request body.
 *
 * - `createBodyValidator(doc, "createItem")`: takes the OpenAPI document and an operation id.
 * - `createBodyValidator(schema)`: takes a schema object; `$ref`s into `#/components` need the `components` key, so pass a doc for those.
 *
 * The check interprets the schema (no code generation, so it runs under a CSP without 'unsafe-eval') and rejects
 * what Huma would reject, reporting every problem with Huma-style keys.
 */
export function createBodyValidator<T = unknown>(spec: OpenApiDocument | JsonSchema, operationId?: string): BodyValidator<T> {
  let schema: JsonSchema;
  if (operationId !== undefined) {
    const doc = spec as OpenApiDocument;
    schema = { ...findBodySchema(doc, operationId), components: doc.components ?? {} };
  } else {
    schema = spec as JsonSchema;
  }
  const run = (values: unknown): FieldErrors => {
    const out: FieldErrors = {};
    check(schema, schema, values, [], out);
    return out;
  };
  return {
    schema,
    validate: run,
    isValid(values): values is T {
      return Object.keys(run(values)).length === 0;
    },
  };
}
