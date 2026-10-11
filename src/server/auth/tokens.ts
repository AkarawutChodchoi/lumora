import { createHmac, randomBytes } from "node:crypto";
import { config } from "../config";

/** A random, URL-safe opaque token. Only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Keyed hash so a leaked database alone cannot be used to forge sessions. */
export function hashToken(token: string): string {
  return createHmac("sha256", config().SESSION_SECRET).update(token).digest("hex");
}
