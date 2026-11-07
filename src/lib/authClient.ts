"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// 2FA sign-in is handled inline on the login page, so no redirect here
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });

/** better-auth error → which of our localized messages to show */
export function authErrorKey(e: { code?: string; status?: number } | null | undefined) {
  if (!e) return "generic" as const;
  if (e.status === 429) return "rate" as const;
  switch (e.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "INVALID_EMAIL":
      return "invalid" as const;
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "exists" as const;
    case "PASSWORD_TOO_SHORT":
    case "PASSWORD_TOO_LONG":
    case "PASSWORD_TOO_WEAK":
      return "weak" as const;
    case "ACCOUNT_BANNED":
      return "banned" as const;
    case "REGISTRATION_CLOSED":
      return "closed" as const;
    case "INVALID_TWO_FACTOR_CODE":
    case "INVALID_CODE":
    case "INVALID_BACKUP_CODE":
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return "code" as const;
    case "INVALID_TOKEN":
      return "token" as const;
    default:
      return "generic" as const;
  }
}
