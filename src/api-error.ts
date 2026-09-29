/** One entry of RFC 9457 `errors` as emitted by Huma. */
export interface ProblemFieldError {
  message?: string;
  location?: string;
  value?: unknown;
}

/** RFC 9457 problem+json body as emitted by Huma. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  errors?: ProblemFieldError[] | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * The one error shape. Structurally a superset of the generated problem body
 * (so it satisfies the `error` type openapi-typescript infers), plus `fieldErrors`.
 */
export class ApiError extends Error implements ProblemDetails {
  override readonly name = "ApiError";
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly type?: string;
  readonly instance?: string;
  readonly errors: ProblemFieldError[];
  /** First message per location, keyed like Huma: `body.title`, `query.limit`, `body.tags[0]`. */
  readonly fieldErrors: Record<string, string>;
  readonly requestId?: string;

  constructor(init: { status: number; title?: string; detail?: string; type?: string; instance?: string; errors?: ProblemFieldError[]; requestId?: string }) {
    const title = init.title ?? `HTTP ${init.status}`;
    const detail = init.detail ?? "";
    super(detail !== "" ? `${title}: ${detail}` : title);
    this.status = init.status;
    this.title = title;
    this.detail = detail;
    if (init.type !== undefined) this.type = init.type;
    if (init.instance !== undefined) this.instance = init.instance;
    if (init.requestId !== undefined) this.requestId = init.requestId;
    this.errors = init.errors ?? [];
    this.fieldErrors = {};
    for (const e of this.errors) {
      if (e.location && e.message && !(e.location in this.fieldErrors)) {
        this.fieldErrors[e.location] = e.message;
      }
    }
  }

  static fromProblem(status: number, body: unknown, fallbackTitle?: string, requestId?: string): ApiError {
    const p: Record<string, unknown> = isRecord(body) ? body : {};
    const errors = Array.isArray(p.errors)
      ? p.errors.filter(isRecord).map((e): ProblemFieldError => {
          const out: ProblemFieldError = {};
          if (typeof e.message === "string") out.message = e.message;
          if (typeof e.location === "string") out.location = e.location;
          if ("value" in e) out.value = e.value;
          return out;
        })
      : [];
    const init: ConstructorParameters<typeof ApiError>[0] = {
      status: typeof p.status === "number" ? p.status : status,
      errors,
    };
    const title = typeof p.title === "string" ? p.title : fallbackTitle;
    if (title !== undefined) init.title = title;
    if (typeof p.detail === "string") init.detail = p.detail;
    if (typeof p.type === "string") init.type = p.type;
    if (typeof p.instance === "string") init.instance = p.instance;
    if (requestId) init.requestId = requestId;
    return new ApiError(init);
  }

  /** Builds an ApiError from a non-2xx Response. Tolerates non-JSON bodies. */
  static async fromResponse(res: Response): Promise<ApiError> {
    let body: unknown;
    try {
      const text = await res.text();
      body = text === "" ? undefined : JSON.parse(text);
    } catch {
      body = undefined;
    }
    return ApiError.fromProblem(res.status, body, res.statusText || undefined, res.headers.get("X-Request-Id") ?? undefined);
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
