import type { ApiError } from "@/lib/contracts";

const STATUS: Record<ApiError["code"], number> = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM: 502,
  NOT_CONFIGURED: 503,
};

/** Throw from any server module; API routes convert it with `toErrorResponse`. */
export class AppError extends Error {
  /** Extra response headers (e.g. `Retry-After` on RATE_LIMITED). */
  readonly headers?: Record<string, string>;

  constructor(
    readonly code: ApiError["code"],
    message: string,
    options?: { cause?: unknown; headers?: Record<string, string> },
  ) {
    super(message, options);
    this.name = "AppError";
    this.headers = options?.headers;
  }
}

/**
 * AppError messages are written for the client. Anything else is unexpected: its text may carry upstream
 * detail, so the client gets a generic message and the real error goes to the server log.
 */
export function toErrorResponse(err: unknown): Response {
  if (!(err instanceof AppError)) {
    console.error("[reroute] unexpected error", err);
    const body: ApiError = { error: "Internal error", code: "INTERNAL" };
    return Response.json(body, { status: STATUS.INTERNAL });
  }
  const body: ApiError = { error: err.message, code: err.code };
  return Response.json(body, { status: STATUS[err.code], headers: err.headers });
}
