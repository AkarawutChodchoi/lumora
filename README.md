# Lumora AI

An AI roleplay and companion web app. Users discover and chat with AI characters, create their own, and have conversations that persist and remember them. It includes coins, a premium plan, safety and moderation tools, and an admin dashboard.

> **เริ่มต้นแบบเร็ว (ภาษาไทย)** — ดูหัวข้อ [วิธีเปิดแอปบนเครื่อง](#วิธีเปิดแอปบนเครื่อง-ภาษาไทย) ด้านล่าง

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| Styling | Tailwind CSS v4, custom dark design system, lucide icons |
| Database | Prisma 6. SQLite for development, PostgreSQL for production |
| Auth | Own session auth: Argon2id password hashing, HMAC-hashed opaque session tokens in httpOnly cookies |
| AI | Provider abstraction (`src/server/ai`): Anthropic Claude and Google Gemini adapters (official SDKs, streaming) and a clearly labelled dev provider. Pick with `AI_PROVIDER` |
| Tests | Vitest (unit and integration against a real SQLite DB), plus an HTTP smoke script |
| Languages | Thai (default) and English. Dictionaries in `src/i18n/` (`en.ts` defines the keys; `th.ts` must match them, which TypeScript enforces). Server error messages are translated in `src/i18n/errors.ts` |

The spec in `../Prompt_*.txt` suggested Flutter + NestJS. We deliberately chose a single Next.js web app for the MVP. The reasons and trade-offs are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#decisions).

## Quick start

Requirements: Node.js ≥ 22.18 (tested on 24.20).

```bash
npm install
cp .env.example .env            # then set SESSION_SECRET to a random 32+ char string
npx prisma migrate dev          # creates prisma/dev.db and applies migrations
npm run db:seed                 # optional: 6 original demo characters
npm run dev                     # http://localhost:3000
```

To create an admin account:

```bash
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a-strong-password' npm run db:seed
```

If the email already belongs to a normal account, the script stops instead of promoting it
(anyone can register any address). Check the account is yours, then add
`SEED_ADMIN_PROMOTE_EXISTING=true` to promote it.

### Real AI replies

**Google Gemini (free tier):** create a key at https://aistudio.google.com, then set
`AI_PROVIDER="gemini"` and `GEMINI_API_KEY`. Default model `gemini-3.8-flash` (`AI_MODEL_GEMINI`).
On the free tier Google may use prompts and replies to improve its products, and rate limits apply
(users see "AI is busy" and are refunded). Non-Gemini model names in admin settings fall back to
`AI_MODEL_GEMINI` automatically.

**Anthropic Claude:**

When no API key is set, the app runs in **development mode**. Replies are placeholders that start with `[Dev mode — not a real AI reply]`, and a yellow banner is shown. To get real replies:

```env
AI_PROVIDER="anthropic"
ANTHROPIC_API_KEY="sk-ant-..."
```

The default model is `claude-opus-5-5` with `effort: low`. Admins can change the model, effort, token limits and price per reply at **/admin/ai** without a redeploy. The key never leaves the server and is never shown in the dashboard.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | `file:./dev.db` (SQLite) or a PostgreSQL URL |
| `SESSION_SECRET` | yes | ≥ 32 chars. Keys the session and reset-token hashes. Rotating it signs everyone out |
| `APP_URL` | yes | Public base URL (used in password-reset links) |
| `AI_PROVIDER` | no | `anthropic` or `dev`. Defaults to `dev` when no key is set |
| `ANTHROPIC_API_KEY` | for real AI | Server-side only |
| `AI_MODEL_STANDARD`, `AI_MODEL_PREMIUM` | no | Initial model routing (admins can override it) |
| `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` | for payments | Payments are disabled until both are set **and** a provider adapter exists (see below) |
| `EMAIL_PROVIDER` | for email | Not implemented yet. In development the reset link is printed to the server log |
| `CRON_SECRET` | for maintenance | Bearer token for `POST /api/cron/maintenance` |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Vitest suite (creates a fresh `prisma/test.db` from the migrations) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run check` | Typecheck, lint and test together |
| `node scripts/smoke.mjs http://localhost:3000` | End-to-end HTTP smoke test against a running dev server. Creates throwaway accounts. Set `SMOKE_ADMIN_EMAIL`/`SMOKE_ADMIN_PASSWORD` to include admin checks |
| `npm run db:migrate` | Create and apply a migration after editing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply migrations in production (non-interactive) |
| `npm run db:seed` | Demo characters and optional admin |

## Project layout

```
prisma/                 schema, migrations, seed
src/app/                pages (App Router) and API route handlers (src/app/api/**)
  (app)/                main app shell: discover, search, characters, chats list, library, coins, profile, safety, memories
  (focus)/chats/[id]    full-screen chat
  (auth)/               login, register, password reset
  admin/                staff dashboard
src/components/         UI: ui/ primitives, chat/, characters/, admin/, ...
src/server/             server-only code
  ai/                   provider interface, adapters, prompt assembly, token budgeting
  auth/                 password hashing, sessions, guards
  domain/               enums, permissions, product catalog
  services/             business logic (chat, characters, memory, credits, billing, moderation, admin, ...)
tests/                  Vitest suites
docs/                   architecture, content policy, implementation checklist
```

## Payments

The coin ledger, purchases, subscriptions, entitlements and a signed, idempotent webhook processor are implemented and tested. **No real payment provider is integrated yet.** Before selling:

1. Choose providers. For digital goods in mobile apps, Apple/Google in-app purchase rules apply. On the web, Stripe or Omise work for Thailand.
2. Write an adapter that verifies the provider's own webhook signature and maps events to `PaymentEventInput` (`src/server/services/billing.ts`). Add the checkout session creation in `src/app/api/billing/checkout/route.ts`.
3. Set `PAYMENT_PROVIDER` and `PAYMENT_WEBHOOK_SECRET`, use separate sandbox and production keys, and test duplicate and out-of-order webhooks against the sandbox.
4. Review pricing, tax/VAT, refund policy, terms of service and consumer-protection requirements.

Until then, the Buy buttons are disabled and the page says so. Nothing ever grants coins without a verified webhook.

## Deployment (Vercel + Neon)

The database is PostgreSQL. Local development and tests use separate schemas inside the
database in `.env` (`?schema=lumora_dev` for the app, `lumora_test` for tests), so they never
touch production data, which lives in the default `public` schema.

1. Create a Neon project and copy its connection string.
2. On Vercel, set these environment variables (Production): `DATABASE_URL` (the Neon string,
   **without** a `schema` parameter), `SESSION_SECRET` (32+ random chars), `APP_URL` (your
   `https://…vercel.app` URL), `AI_PROVIDER` / `ANTHROPIC_API_KEY` (optional), `CRON_SECRET`.
3. Deploy (`npx vercel --prod`, or connect a GitHub repo). The `vercel-build` script runs
   `prisma migrate deploy` before `next build`, so tables are created/updated automatically.
4. Create the first admin: run `npm run db:seed` locally with `DATABASE_URL` pointing at
   production and `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` set (use a strong password).
5. Maintenance runs daily through Vercel Cron (`vercel.json`), which calls
   `GET /api/cron/maintenance` with `Authorization: Bearer $CRON_SECRET`. Set `CRON_SECRET`
   (16+ random chars) on Vercel or the job is rejected and deleted accounts are never erased.
6. Limits: rate limits are stored in the database (`RateLimitBucket`), so they hold across
   serverless instances. A reply streams for at most 48 seconds (the chat route's limit is 60);
   after that the text so far is saved as a shortened reply, or the coins are refunded.
7. Back up before migrations (Neon supports point-in-time restore and branches). Prisma
   migrations are forward-only; roll back by redeploying the previous build and restoring data.

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The current status of every feature is in [docs/CHECKLIST.md](docs/CHECKLIST.md).

---

## วิธีเปิดแอปบนเครื่อง (ภาษาไทย)

1. เปิด Terminal ที่โฟลเดอร์ `lumora`
2. รัน `npm run dev`
3. เปิดเบราว์เซอร์ไปที่ http://localhost:3000
4. สมัครสมาชิกได้เลย ระบบจะแจก 50 เหรียญให้ หรือเข้าด้วยบัญชี admin สำหรับทดสอบ (ดูรายละเอียดในรายงานที่ Claude ส่งให้)

### ลองบนมือถือ (Wi-Fi เดียวกับคอม)

1. รัน `npm run build` แล้ว `npm run start:lan` (หรือ `npm run dev:lan` ระหว่างพัฒนา)
2. ครั้งแรก Windows จะถามเรื่อง Firewall ให้กด **Allow**
3. บนมือถือเปิด `http://<IP ของคอม>:3000` (ดู IP ด้วยคำสั่ง `ipconfig` ที่หัวข้อ Wi-Fi → IPv4 Address)
4. เพิ่มลงหน้าจอโฮม: iPhone ใช้ Safari → ปุ่มแชร์ → "เพิ่มไปยังหน้าจอโฮม" / Android ใช้ Chrome → เมนู ⋮ → "เพิ่มลงในหน้าจอหลัก"

ถ้าเข้าไม่ได้: Wi-Fi บางที่ (มหาวิทยาลัย/ร้านกาแฟ) บล็อกไม่ให้อุปกรณ์มองเห็นกัน ให้เปิดฮอตสปอตจากมือถือแล้วให้คอมต่อแทน

ถ้ายังไม่ได้ใส่ `ANTHROPIC_API_KEY` ในไฟล์ `.env` ตัวละครจะตอบเป็นข้อความทดสอบที่ขึ้นต้นด้วย `[Dev mode]` ยังไม่ใช่ AI จริง
