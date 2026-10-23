import { connection } from "next/server";
import type { ApiError } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { MAX_UPLOAD_BYTES, policyLibrary, uploadPolicyPackage } from "@/lib/rights/packages";
import { requireReviewer } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { clientAddress, consumeRateLimit } from "@/lib/server/rate-limit";
import { POLICY_WRITE_LIMIT } from "./limits";

/**
 * GET /api/policies[?club=] → { policies: (PolicyPackageSummary & { isDefault })[], defaults: { [club]: packageId },
 * uploadsAvailable }. Public read; who uploaded a package (name, file name) is shown to signed-in reviewers only.
 * There is no global "active" policy: each evaluation uses one package per club.
 */
export const GET = route(async (req: Request) => {
  await connection();
  const club = new URL(req.url).searchParams.get("club");
  const [library, reviewer] = await Promise.all([policyLibrary(), requireReviewer(req).then(() => true, () => false)]);
  const policies = library.packages
    .filter((p) => !club || p.club === club)
    .map(({ uploadedBy, fileName, ...p }) => ({
      ...p,
      ...(reviewer ? { uploadedBy, fileName } : { warnings: p.warnings.filter((w) => !w.startsWith("Uploaded by")) }),
      isDefault: library.defaults[p.club] === p.id,
    }));
  return Response.json({ policies, defaults: library.defaults, uploadsAvailable: library.uploadsAvailable });
});

const UNSUPPORTED: ApiError = {
  error: "Only JSON rule packages can be imported. Contract (PDF) extraction is not supported in this build.",
  code: "BAD_REQUEST",
};

/** Multipart framing on top of the file itself. */
const MULTIPART_OVERHEAD = 16 * 1024;
const TOO_LARGE = `The rule package is larger than ${MAX_UPLOAD_BYTES / 1024} KB`;

/** The request body, read with a hard byte cap (Content-Length may be absent with chunked uploads). */
async function boundedBody(req: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(req.headers.get("content-length") ?? 0) > max) throw new AppError("BAD_REQUEST", TOO_LARGE);
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new AppError("BAD_REQUEST", TOO_LARGE);
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.byteLength;
  }
  return body;
}

/**
 * POST /api/policies — signed-in reviewer uploads a JSON rule package: a JSON body (the policy document) or
 * multipart `file` (≤ 200 KB). Stored as DEMO whatever it declares → 201 { package, notes }. PDF/DOCX/TXT/CSV → 422.
 */
export const POST = route(async (req: Request) => {
  const { reviewer } = await requireReviewer(req);
  consumeRateLimit(POLICY_WRITE_LIMIT, clientAddress(req));
  const body = await boundedBody(req, MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD);
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await new Response(body, { headers: { "content-type": type } }).formData().catch(() => {
      throw new AppError("BAD_REQUEST", "Could not read the uploaded form");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("BAD_REQUEST", "Attach the rule package as the form field `file`");
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("BAD_REQUEST", TOO_LARGE);
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") return Response.json(UNSUPPORTED, { status: 422 });
    const result = await uploadPolicyPackage({ text: await file.text(), fileName: file.name, uploadedBy: reviewer });
    return Response.json(result, { status: 201 });
  }
  if (!/^application\/(.+\+)?json\b/i.test(type)) return Response.json(UNSUPPORTED, { status: 422 });
  const result = await uploadPolicyPackage({ text: new TextDecoder().decode(body), uploadedBy: reviewer });
  return Response.json(result, { status: 201 });
});
