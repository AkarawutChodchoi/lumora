import type { Role } from "./enums";

// Role-based permissions. Server code checks permissions, never role names directly.
export const PERMISSIONS = [
  "admin.view",
  "users.view",
  "users.enforce",
  "users.process_deletion",
  "characters.moderate",
  "reports.review",
  "appeals.decide",
  "billing.view",
  "billing.adjust",
  "ai.configure",
  "audit.view",
  "characters.edit_any",
  "users.manage_roles",
  "users.grant_premium",
  "users.erase",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MODERATOR: Permission[] = [
  "admin.view",
  "users.view",
  "users.enforce",
  "characters.moderate",
  "reports.review",
  "appeals.decide",
  "audit.view",
];

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  user: new Set(),
  moderator: new Set(MODERATOR),
  admin: new Set(PERMISSIONS),
};

export function can(role: string, permission: Permission): boolean {
  return GRANTS[role as Role]?.has(permission) ?? false;
}
