import { reconcilePayments } from "@/lib/server/payments/reconcile";
import { cronAuthorized } from "@/lib/server/cron";

// Payment reconciliation on its own. Vercel Hobby allows only daily crons, so the daily
// maintenance job runs it too; point an external scheduler here (every 15 minutes) for
// faster catch-up. Requires "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const r = await reconcilePayments();
  if (r.notable.length) console.log("reconcile:", r.notable.join(" | "));
  return Response.json(r);
}
