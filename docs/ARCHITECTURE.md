# Lumora AI — Architecture (v2)

Version 2 moves Lumora onto Alinmanga's stack and structure: Next.js 16 + Drizzle/Neon +
better-auth with 2FA + gateway-based payments + multi-role permissions + the Alinmanga
design system. Lumora's chat, character, memory and moderation logic is unchanged in
behaviour; it was ported from Prisma to Drizzle.

## Decisions

| Topic | Choice | Why |
|---|---|---|
| Framework | Next.js 16, `src/proxy.ts` (was `middleware.ts`), route handlers for the chat/character API, server actions for payments | Same as Alinmanga; the SSE chat stream needs a route handler |
| Database | Drizzle ORM, node-postgres `Pool` | Alinmanga uses Drizzle on Neon. node-postgres (not neon-http) because the chat engine needs interactive transactions (row locks for the wallet and the conversation lock), and it also works with a plain Postgres in CI |
| Accounts | better-auth (scrypt, DB sessions, TOTP 2FA, DB-backed rate limits) | Same as Alinmanga; replaces the hand-written argon2/session code |
| Roles | `user_role` table, several roles per user, staff powers need 2FA | Same as Alinmanga (`moderator`, `finance`, `admin`) |
| Payments | `Gateway` interface: Omise PromptPay (prod) and mock (dev/tests), webhook + poll + reconcile all call one idempotent `settle()` | Same as Alinmanga; replaces the provider-neutral HMAC webhook |
| Wallet | `wallet(paid, bonus)` + append-only `coin_ledger` with unique `reference` | Alinmanga's two buckets plus Lumora's idempotency keys |
| Lumora Plus | `membership` periods bought by QR (30/90 days), staff grants have no payment | One-off QR payments can't auto-renew, so periods stack |
| Theme | CSS variables on `<html data-theme data-accent data-text>`, cookies for first paint, `user.prefs` for other devices | No flash on load; follows the user across devices |

## Layout

```
src/db/                      schema.ts (all tables), index.ts (pool + helpers)
src/proxy.ts                 guest redirect for private pages, Origin check on API writes
src/lib/permissions.ts       roles × permissions (shared by server and UI)
src/lib/domain/              catalog (packs, plans), enums, taxonomy
src/lib/server/              auth.ts (better-auth), access.ts (current user, guards, 2FA rule),
                             wallet.ts, rateLimit.ts, audit.ts, notify.ts, payments/*,
                             chat.ts, conversations.ts, characters.ts, memory.ts, admin.ts …
src/lib/server/ai/           providers, prompt assembly, model routing
src/app/(app)/               member pages (Alinmanga header + phone bottom tabs)
src/app/(focus)/chats/[id]   full-screen chat
src/app/admin/               back office (sidebar, permission-filtered menu)
src/app/api/                 JSON API, /api/auth/[...all], webhooks, cron
drizzle/                     SQL migrations
scripts/                     migrate, seed, grant-role, reconcile
```

## Data model (summary)

- Auth: `user` (profile, status, bannedAt, 2FA flag, prefs), `session`, `account`, `verification`, `two_factor`, `rate_limit`.
- Roles & audit: `user_role`, `audit_log` (before/after/reason/ip, append only).
- Characters: `character` (tags/categories as text arrays), `character_version` (JSON snapshot), `favorite`, `character_block`, `image`.
- Chat: `conversation` (activeGenerationId lock, nextSequence), `message` (append-only sequence), `generation` (one per AI call, idempotency key).
- Memory: `memory` scoped by (user, character), slot keys, provenance.
- Money: `wallet`, `coin_ledger`, `payment`, `webhook_event`, `membership`.
- Safety: `report`, `enforcement`, `appeal`. Settings: `site_setting`. Inbox: `notification`.

## Chat message lifecycle

Unchanged from v1: `prepareGeneration` validates, moderates the input, takes the
conversation lock, and in one transaction creates the generation, messages and the coin
charge (`gen:<id>:charge`, bonus coins first). `runGeneration` streams, buffers and
moderates the whole reply before saving or sending it. `settle` (chat) finalises in one
transaction: completed / failed (full refund `gen:<id>:refund`, to the same buckets) /
cancelled (free). Stale replies (dead workers) are closed out and refunded.

## Payments

1. `createPayment(productId)` (server action): price from the catalog, at most 3 open QR codes and 5 attempts/min per user; the payment row is written before calling the gateway.
2. The customer pays the QR. The gateway calls `POST /api/webhooks/payment/<gateway>`: signature checked, raw event stored once per `(gateway, event_id)`, then `settle()` asks the gateway API for the charge.
3. `settle()` credits only if the gateway says paid with the exact amount/currency/payment id: one transaction marks the payment paid (only from an unpaid state), writes `topup` (paid coins) and `bonus` rows, or a `membership` period plus its coin allowance. Wrong amount → `mismatch` for staff review.
4. The result page polls `getPayment()`, the admin "re-check" button and the daily reconcile call the same `settle()`.

## Security controls

| Threat | Control |
|---|---|
| Password theft | scrypt (better-auth), 8–128 chars with a letter and a number, generic errors |
| Account takeover | TOTP 2FA (required for staff powers), backup codes, sign-in rate limit 5/min, 2FA verify 5/min |
| Session theft | DB sessions, httpOnly SameSite=Lax cookies (`lumora.*`, Secure on https), revoked on password reset, role change, suspension |
| CSRF | SameSite cookies, better-auth origin check, Origin/Sec-Fetch-Site check on all other non-GET API calls |
| IDOR | Every resource loaded with an owner/visibility check; other users' private data returns 404 |
| Privilege escalation | Permission checks on the server (route guard and again inside services); dormant staff roles without 2FA |
| Payment fraud | Prices server-side only; coins only from gateway-confirmed charges with exact amount; webhook signatures (5-minute window); unique ledger references; CHECK balance ≥ 0 |
| Abuse | DB-backed rate limits (sign-up, sign-in, reset, chat, reports, appeals, uploads, payments, polling) |
| Injection | Drizzle parameterised SQL, React escaping, Zod on every input |
| Headers | X-Frame-Options DENY, nosniff, strict referrer, permissions policy, HSTS |

## Moving production to v2

Production (https://lumora-nine-rose.vercel.app) still runs v1 on the Neon `public` schema.
v2's tables are different (better-auth accounts, wallet buckets, new money tables), and
v1 password hashes are argon2 while better-auth uses scrypt. Options:

1. **Fresh start** (simplest): point v2 at a new database; members sign up again.
2. **Migrate**: copy users (as better-auth `user` + `account` rows with a custom
   `password.verify` that accepts the old argon2 hashes), characters, versions,
   conversations, messages, memories, and convert each credit balance to a `bonus`
   wallet with one opening ledger row. Write and dry-run this script on a Neon branch first.
