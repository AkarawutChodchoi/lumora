// Who may do what. Shared by server guards (the real check) and the UI (only
// hides what you can't use). Keep docs/PERMISSIONS.md in sync with this file.

export const ROLES = ["member", "moderator", "finance", "admin"] as const;
export type Role = (typeof ROLES)[number];
/** Roles staff can grant; "member" is implicit for everyone signed in. */
export const STAFF_ROLES = ["moderator", "finance", "admin"] as const satisfies readonly Role[];

export const PERMISSIONS = {
  /** open /admin */
  "admin.view": ["moderator", "finance", "admin"],
  "users.view": ["moderator", "finance", "admin"],
  /** warnings, restrictions, suspensions, reinstatement */
  "users.enforce": ["moderator", "admin"],
  "users.process_deletion": ["admin"],
  "users.erase": ["admin"],
  "users.manage_roles": ["admin"],
  /** grant Lumora Plus without a payment (with a reason) */
  "users.grant_premium": ["finance", "admin"],
  "characters.moderate": ["moderator", "admin"],
  "characters.edit_any": ["admin"],
  "reports.review": ["moderator", "admin"],
  "appeals.decide": ["moderator", "admin"],
  /** payments, revenue, webhooks */
  "billing.view": ["finance", "admin"],
  /** add/deduct coins (ledger entry + reason) */
  "billing.adjust": ["finance", "admin"],
  /** re-check a payment with the gateway */
  "payments.recheck": ["finance", "admin"],
  "ai.configure": ["admin"],
  "audit.view": ["admin"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

/** Roles that must have 2FA turned on before they can use their extra powers. */
export const NEEDS_2FA: readonly Role[] = ["moderator", "finance", "admin"];

export const can = (roles: readonly string[], p: Permission) => (PERMISSIONS[p] as readonly string[]).some((r) => roles.includes(r));

export const isStaff = (roles: readonly string[]) => roles.some((r) => r !== "member");
