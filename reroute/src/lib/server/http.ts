import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { AppError, toErrorResponse } from "@/lib/errors";

/** Parse a JSON request body against `schema`; malformed JSON or schema mismatch → BAD_REQUEST. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON");
  }
  return parseInput(schema, body);
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError("BAD_REQUEST", z.prettifyError(parsed.error));
  return parsed.data;
}

/** Wrap a route handler: every thrown error becomes the uniform ApiError body. */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      unstable_rethrow(err); // let Next.js interrupts (prerender bailout of connection()) through
      if (!(err instanceof AppError) || err.code === "INTERNAL") console.error("[reroute api]", err);
      return toErrorResponse(err);
    }
  };
}
