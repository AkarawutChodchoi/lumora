import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Constant-time check of `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it). */
export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}
