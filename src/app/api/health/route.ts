import { db } from "@/server/db";
import { activeAiProvider, paymentsEnabled } from "@/server/config";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = "error";
  }
  const healthy = database === "ok";
  return Response.json(
    { status: healthy ? "ok" : "degraded", database, aiProvider: activeAiProvider(), payments: paymentsEnabled() ? "configured" : "not_configured" },
    { status: healthy ? 200 : 503 },
  );
}
