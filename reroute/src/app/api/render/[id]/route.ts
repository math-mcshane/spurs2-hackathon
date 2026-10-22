import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { connection, type NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { decideEdit } from "@/lib/server/decide";
import { route } from "@/lib/server/http";
import { mediaProcessingApproved, renderPath } from "@/lib/server/render";
import { getReceipt } from "@/lib/server/store";

/**
 * GET /api/render/[id] — stream a rendered derivative. Gate re-checked on every request:
 * processing approved, review not REJECTED, and a fresh verdict for the derivative still ALLOWED.
 * Supports single byte ranges so <video> can seek.
 */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/render/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  if (!mediaProcessingApproved()) {
    throw new AppError("FORBIDDEN", "Media processing is not approved (MEDIA_PROCESSING_APPROVED != true)");
  }
  const file = renderPath(id);
  const receipt = await getReceipt(id);
  if (receipt.humanReviewStatus === "REJECTED") throw new AppError("FORBIDDEN", "Derivative was rejected in review");
  const { decision } = await decideEdit(receipt.edit, receipt.intent);
  if (decision.verdict !== "ALLOWED") {
    throw new AppError("FORBIDDEN", `Derivative is now ${decision.verdict} for its intent`);
  }

  const size = await stat(file).then(
    (s) => s.size,
    () => {
      throw new AppError("NOT_FOUND", `No render for receipt ${id}`);
    },
  );
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  if (!range || (!range[1] && !range[2])) {
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 206,
    headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
});
