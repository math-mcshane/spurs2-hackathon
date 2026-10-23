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
 * uploadsAvailable }. Public read. There is no global "active" policy: each evaluation uses one package per club.
 */
export const GET = route(async (req: Request) => {
  await connection();
  const club = new URL(req.url).searchParams.get("club");
  const library = await policyLibrary();
  const policies = library.packages
    .filter((p) => !club || p.club === club)
    .map((p) => ({ ...p, isDefault: library.defaults[p.club] === p.id }));
  return Response.json({ policies, defaults: library.defaults, uploadsAvailable: library.uploadsAvailable });
});

const UNSUPPORTED: ApiError = {
  error: "Only JSON rule packages can be imported. Contract (PDF) extraction is not supported in this build.",
  code: "BAD_REQUEST",
};

/** Multipart framing on top of the file itself. */
const MULTIPART_OVERHEAD = 16 * 1024;

/**
 * POST /api/policies — signed-in reviewer uploads a JSON rule package: a JSON body (the policy document) or
 * multipart `file` (≤ 200 KB). Stored as DEMO whatever it declares → 201 { package, notes }. PDF/DOCX/TXT/CSV → 422.
 */
export const POST = route(async (req: Request) => {
  const { reviewer } = await requireReviewer(req);
  consumeRateLimit(POLICY_WRITE_LIMIT, clientAddress(req));
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) {
    throw new AppError("BAD_REQUEST", `The rule package is larger than ${MAX_UPLOAD_BYTES / 1024} KB`);
  }
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => {
      throw new AppError("BAD_REQUEST", "Could not read the uploaded form");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("BAD_REQUEST", "Attach the rule package as the form field `file`");
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("BAD_REQUEST", `The rule package is larger than ${MAX_UPLOAD_BYTES / 1024} KB`);
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") return Response.json(UNSUPPORTED, { status: 422 });
    const result = await uploadPolicyPackage({ text: await file.text(), fileName: file.name, uploadedBy: reviewer });
    return Response.json(result, { status: 201 });
  }
  if (!/^application\/(.+\+)?json\b/i.test(type)) return Response.json(UNSUPPORTED, { status: 422 });
  const result = await uploadPolicyPackage({ text: await req.text(), uploadedBy: reviewer });
  return Response.json(result, { status: 201 });
});
