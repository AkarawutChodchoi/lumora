# Lumora AI

AI roleplay and companion chat (web + Android wrapper). Version 2 runs on the same
stack, structure, account system, payment system and security model as Alinmanga,
with Lumora's chat, character, memory and moderation features on top.

## Stack

| | |
|---|---|
| App | Next.js 16 (App Router, Turbopack, `src/proxy.ts`), React 19.3, Tailwind CSS 4 |
| Database | PostgreSQL on Neon, Drizzle ORM (`src/db/schema.ts`, migrations in `drizzle/`), node-postgres driver |
| Accounts | better-auth: email + password, 30-day sessions, TOTP two-step sign-in (2FA), rate limits stored in Postgres |
| Roles | member / moderator / finance / admin, several per user (`src/lib/permissions.ts`), staff powers need 2FA |
| Payments | Gateway abstraction (`src/lib/server/payments`): Omise PromptPay QR in production, a mock gateway for local tests |
| AI | Anthropic Claude or Google Gemini (`src/lib/server/ai`), labelled dev provider without keys |
| Design | Alinmanga design system: Kanit / IBM Plex Sans Thai / Sarabun, dark `#0f0f12` surfaces; tone (dark, midnight, light, device) and accent colour (amber, rose, violet, sky, emerald, crimson) chosen in Profile |

## Quick start

```bash
npm install
cp .env.example .env.local      # fill DATABASE_URL, DIRECT_URL, TEST_DATABASE_URL, BETTER_AUTH_SECRET
npm run db:migrate              # create the tables
npm run db:seed                 # demo characters
npm run dev                     # http://localhost:3000
```

First admin: sign up on the site, then

```bash
npm run role -- grant you@example.com admin
```

and turn on two-step sign-in in Profile → Security. Until then the admin powers stay off
(`ADMIN_2FA_OPTIONAL=1` skips this in local development only).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run check` | typecheck + lint + tests |
| `npm test` | Vitest against `TEST_DATABASE_URL` (migrated, never wiped) |
| `npm run db:generate` | new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | apply migrations (also runs in `vercel-build`) |
| `npm run db:seed` | demo characters |
| `npm run role -- grant\|revoke\|list <email> [role]` | staff roles |
| `npm run reconcile` | settle payments whose webhook never arrived |

## Payments

Coins and Lumora Plus are bought with a PromptPay QR (10-minute, single-use). The browser
only sends a product id; prices come from `src/lib/domain/catalog.ts`. Coins are credited
only after the gateway itself reports the charge as paid with the exact amount
(`payments/settle.ts`), from a signed webhook, the result page's polling, the admin
"re-check" button or the daily reconcile job — and only once (unique ledger references).

Wallets have two buckets like Alinmanga: `paid` (bought) and `bonus` (signup, daily,
Plus allowance, pack bonuses). Spending takes bonus first. Every change is a `coin_ledger`
row in the same transaction as the wallet update; a CHECK constraint keeps balances ≥ 0.

Local testing: `PAYMENT_GATEWAY=mock` + `ALLOW_MOCK_GATEWAY=1`, then use the test buttons on
`/coins/result` (they send a signed webhook to the app, the same path a real gateway takes).

Go-live with Omise: set `PAYMENT_GATEWAY=omise`, `OMISE_SECRET_KEY`, `OMISE_WEBHOOK_SECRET`,
register `https://<site>/api/webhooks/payment/omise`, and run the sandbox flow first.

## Deployment (Vercel + Neon)

Environment variables: `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, AI keys, payment keys. `vercel-build` applies
migrations before building. The daily cron (`vercel.json`) reconciles payments and runs
maintenance; Vercel Hobby allows only daily crons, so for faster catch-up point an external
scheduler at `/api/cron/reconcile` every 15 minutes with the same bearer token.

Version 2 uses a **new database schema**. Production still runs version 1 (Prisma) on the
`public` schema; deploy v2 to a fresh database (or migrate the data first) — see
`docs/ARCHITECTURE.md` → "Moving production to v2".

More: `docs/ARCHITECTURE.md`, `docs/PERMISSIONS.md`, `docs/CONTENT_POLICY.md`, `docs/CHECKLIST.md`.
