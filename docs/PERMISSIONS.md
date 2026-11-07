# Permissions

Source of truth: `src/lib/permissions.ts`. Server checks live in `src/lib/server/access.ts`
(`requirePermission`, `pageStaff`) and again inside the admin services. The UI only hides
what a role can't use.

## Roles

| Role | Thai label | Who |
|---|---|---|
| member | สมาชิก | everyone signed in (implicit, not stored) |
| moderator | ผู้ดูแลเนื้อหา | reviews characters, reports, appeals, enforces rules |
| finance | การเงิน | payments, coin adjustments, Lumora Plus grants |
| admin | ผู้ดูแลระบบ | everything |

One user can hold several roles (table `user_role`).

**2FA rule:** moderator, finance and admin powers are inactive until the account turns on
two-step sign-in (Profile → Security). `ADMIN_2FA_OPTIONAL=1` skips this in local development
only; it is ignored in production.

## Matrix

| Permission | moderator | finance | admin |
|---|:-:|:-:|:-:|
| `admin.view`, `users.view` | ✓ | ✓ | ✓ |
| `users.enforce` (warn, restrict, suspend, reinstate) | ✓ | | ✓ |
| `characters.moderate`, `reports.review`, `appeals.decide` | ✓ | | ✓ |
| `billing.view`, `billing.adjust`, `payments.recheck`, `users.grant_premium` | | ✓ | ✓ |
| `characters.edit_any`, `users.manage_roles`, `users.erase`, `users.process_deletion`, `ai.configure`, `audit.view` | | | ✓ |

## Guard rails

- Nobody can act on their own account or change their own roles (no lock-out).
- Moderators cannot act on staff accounts; admins must remove the admin role before suspending.
- Suspension sets `banned_at`, deletes every session, and blocks new sign-ins.
- Role changes sign the user out everywhere.
- Every role change, enforcement, coin adjustment, Plus grant and payment re-check writes an `audit_log` row.
- Nobody can mark a payment as paid by hand; "re-check" only asks the gateway again.
