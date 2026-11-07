import { sql } from "drizzle-orm";
import { db } from "@/db";
import { activeAiProvider, paymentsEnabled } from "@/lib/server/config";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = "ok";
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "error";
  }
  const healthy = database === "ok";
  return Response.json(
    { status: healthy ? "ok" : "degraded", database, aiProvider: activeAiProvider(), payments: paymentsEnabled() ? "configured" : "not_configured" },
    { status: healthy ? 200 : 503 },
  );
}
