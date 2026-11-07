import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { grantSignupBonus } from "./wallet";
import { getFeatureFlags } from "./settings";
import { logger } from "./logger";
import { emailDeliveryEnabled } from "./config";

// Accounts, sessions and 2FA (better-auth), set up like Alinmanga:
// - email + password (scrypt), 30-day sessions stored in Postgres, httpOnly cookies
// - TOTP two-factor sign-in; staff powers stay off until it is enabled (see access.ts)
// - rate limits stored in Postgres so they hold across serverless instances
// - suspended (banned) accounts cannot open a session; password reset signs out everywhere

/** Lumora's password rule, on top of better-auth's 8–128 length check. */
export const PASSWORD_RULE = (p: string) => /[A-Za-z]/.test(p) && /\d/.test(p);

const PASSWORD_PATHS = new Set(["/sign-up/email", "/reset-password", "/change-password"]);

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_SITE_URL].filter((x): x is string => !!x),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, rateLimit: schema.rateLimit, twoFactor: schema.twoFactor },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 30 * 60,
    async sendResetPassword({ user, url }) {
      if (emailDeliveryEnabled()) {
        // Email delivery adapter goes here once a provider is configured.
        logger.warn("email_provider_not_implemented", {});
      } else if (process.env.NODE_ENV !== "production") {
        // Development only: there is no email service, so print the link locally.
        console.log(`\n[DEV ONLY] Password reset link for ${user.email}: ${url}\n`);
      } else {
        logger.warn("password_reset_email_unavailable", { userId: user.id });
      }
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: "lumora",
    // Vercel puts the client IP first in x-forwarded-for
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/request-password-reset": { window: 60 * 60, max: 3 },
      "/change-password": { window: 15 * 60, max: 10 },
      // AUTH_SIGNUP_LIMIT only for local testing; production keeps 5 per 10 minutes per IP
      "/sign-up/email": { window: 60 * 10, max: Number(process.env.AUTH_SIGNUP_LIMIT ?? 5) },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email" && !(await getFeatureFlags()).registrationOpen) {
        throw new APIError("FORBIDDEN", { message: "Registration is temporarily closed", code: "REGISTRATION_CLOSED" });
      }
      if (PASSWORD_PATHS.has(ctx.path)) {
        const body = (ctx.body ?? {}) as { password?: unknown; newPassword?: unknown };
        const pw = ctx.path === "/sign-up/email" ? body.password : body.newPassword;
        if (typeof pw === "string" && !PASSWORD_RULE(pw)) {
          throw new APIError("BAD_REQUEST", { message: "Use at least one letter and one number", code: "PASSWORD_TOO_WEAK" });
        }
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (u) => {
          await db.transaction((tx) => grantSignupBonus(tx, u.id));
        },
      },
    },
    session: {
      create: {
        // suspended accounts can't sign in at all
        before: async (sess) => {
          const [u] = await db.select({ bannedAt: schema.user.bannedAt }).from(schema.user).where(eq(schema.user.id, sess.userId));
          if (u?.bannedAt) throw new APIError("FORBIDDEN", { message: "This account is suspended", code: "ACCOUNT_BANNED" });
        },
      },
    },
  },
  appName: "Lumora AI",
  plugins: [twoFactor({ issuer: "Lumora AI" }), nextCookies()],
});

/** Sign a user out everywhere (suspension, role change, password change by staff). */
export async function revokeAllSessions(userId: string) {
  await db.delete(schema.session).where(eq(schema.session.userId, userId));
}
