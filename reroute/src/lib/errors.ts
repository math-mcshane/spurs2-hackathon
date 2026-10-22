import type { ApiError } from "@/lib/contracts";

const STATUS: Record<ApiError["code"], number> = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL: 500,
  UPSTREAM: 502,
  NOT_CONFIGURED: 503,
};

/** Throw from any server module; API routes convert it with `toErrorResponse`. */
export class AppError extends Error {
  constructor(
    readonly code: ApiError["code"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export function toErrorResponse(err: unknown): Response {
  const appErr =
    err instanceof AppError ? err : new AppError("INTERNAL", err instanceof Error ? err.message : String(err));
  const body: ApiError = { error: appErr.message, code: appErr.code };
  return Response.json(body, { status: STATUS[appErr.code] });
}
