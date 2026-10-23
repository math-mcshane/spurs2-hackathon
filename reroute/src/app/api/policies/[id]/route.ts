import { connection, type NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { defaultPackageFor, describeRule, getPolicyPackage } from "@/lib/rights/packages";
import { route } from "@/lib/server/http";

/** GET /api/policies/[id] → { policy: PolicyPackageSummary & { isDefault }, rules: PlainRule[] } (rules in plain language). */
export const GET = route(async (_req: NextRequest, ctx: RouteContext<"/api/policies/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const pkg = await getPolicyPackage(id);
  if (!pkg) throw new AppError("NOT_FOUND", `Policy package "${id}" not found`);
  const workspaceDefault = await defaultPackageFor(pkg.summary.club);
  return Response.json({
    policy: { ...pkg.summary, isDefault: workspaceDefault?.id === pkg.summary.id },
    rules: pkg.policy.rules.map(describeRule),
  });
});
