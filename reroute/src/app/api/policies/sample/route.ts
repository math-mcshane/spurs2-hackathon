import { SAMPLE_UPLOAD_POLICY } from "@/lib/rights/registry";

/** GET /api/policies/sample → the fictional upload sample (Tottenham international window) as a JSON download. */
export function GET(): Response {
  return new Response(`${JSON.stringify(SAMPLE_UPLOAD_POLICY, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="tottenham-international-window.sample.json"',
    },
  });
}
