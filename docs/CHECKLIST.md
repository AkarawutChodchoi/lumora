# Implementation checklist

Legend: ✅ done and tested · 🟡 done with limitations · ⬜ not started

| Area | Status | Notes |
|---|---|---|
| Project setup, env config, error handling, logging, health check | ✅ | `GET /api/health` |
| Landing page and responsive shell (sidebar / bottom nav) | ✅ | Back button on non-tab pages (phones and desktop), admin "back to app" on phones |
| Register / login / logout / password change | ✅ | Argon2id, rate limits, session revocation |
| Forgot password | 🟡 | Token flow works. **No email sender**: the link is printed to the server log in development only |
| Profile, preferences, data deletion, account deletion | ✅ | Erasure runs after 7 days via `/api/cron/maintenance` |
| Discover, search, categories, tags, sorting | ✅ | Keyword search (SQL `LIKE`) |
| Character CRUD, versions, publish (public/unlisted/private), favorites, block | ✅ | |
| Character image upload | 🟡 | HTTPS image URL plus a generated portrait. **No object-storage upload yet** |
| Chat: streaming, history pagination, stop, regenerate, edit-last, rename, pin, delete | ✅ | SSE. Continues after disconnect. Replies whose server worker died (app closed, function stopped) are closed out after 75s or immediately on Stop: partial text is kept, otherwise refunded. Stop works after reopening the app |
| AI provider abstraction: Anthropic + Google Gemini adapters | 🟡 | **Gemini is live in production** (free tier, default `gemini-3.5-flash-lite`) and was verified with real Thai/English chats. Anthropic adapter not yet tested live (no key). Free-tier note: Google may use prompts/replies to improve its products |
| Prompt assembly, token budgeting, prompt-injection hardening | ✅ | |
| Memory: extraction, conflicts, retrieval, limits, expiry, user management | ✅ | Rule-based. LLM inference and vector search are not built |
| Conversation summarisation for very long chats | ⬜ | Oldest turns are dropped when over budget |
| Coins: ledger, daily bonus, charge/refund, admin adjustments | ✅ | |
| Purchases and subscriptions | 🟡 | Webhook processing and entitlements are done and tested. **No real payment provider or checkout** |
| Moderation: rules, reports, auto-hide, enforcement, appeals, audit | ✅ | |
| Admin dashboard: overview, users, characters, reports, appeals, billing, AI config, flags, audit | ✅ | |
| Admin taxonomy management (edit categories) | ⬜ | Categories are a fixed list in code |
| Prompt version management (multiple stored versions) | 🟡 | One policy version in code, plus a label setting |
| Chat model picker with per-model prices | ✅ | `src/server/ai/models.ts`. Gemini Flash-Lite 5 / 3.5 Flash 8 / 3.8 Flash 12 coins; Gemini Pro 30 (needs `AI_PAID_MODELS=true`); Claude Haiku 10 / Sonnet 20 / Opus 40 (needs `ANTHROPIC_API_KEY`). Saved per user (`User.chatModel`). If a cheaper fallback model answers, the difference is refunded |
| Reply style preference (short / balanced / detailed) | ✅ | `User.responseStyle`, added to the prompt as a separate non-cached block |
| Coin transparency | ✅ | Price list on the Coins page, balance + model chip under the chat box, ledger history |
| Chats inbox | ✅ | Compact header; character notes only from the 10 most recently chatted characters |
| Tests | ✅ | 113 Vitest tests plus an HTTP smoke script |
| CI | ✅ | `.github/workflows/ci.yml` (not run here: no GitHub remote) |
| PostgreSQL + production deploy | ✅ | Neon (Singapore) + Vercel (sin1): https://lumora-nine-rose.vercel.app. Dev/test use `lumora_dev` / `lumora_test` schemas |
| Android APK (Trusted Web Activity via PWABuilder) | ✅ | `public/lumora.apk`; signing key kept outside the repo in `../lumora-android/` (back it up) |
| Native mobile apps (Flutter) | ⬜ | Out of MVP scope by decision |
| Thai + English UI with language switcher | ✅ | Thai is the default; choice stored in the `lumora_locale` cookie. API errors are localized too. `tests/i18n.test.ts` checks key parity and that every server error has a Thai translation |
| Installable web app (manifest, icons, iOS full-screen, safe areas, install hint) | ✅ | `npm run start:lan` for phone testing on the same Wi-Fi. Android full-screen install prompt requires HTTPS (a deployed site) |
| Light theme + text size | ✅ | Profile → Appearance (dark / light / follow device; small / normal / large). Stored per device in cookies, applied on first paint |
| Thai demo characters | ⬜ | Seeded demo characters are written in English |

## Next steps (in priority order)

1. Add a real `ANTHROPIC_API_KEY` and run a manual live chat test, including Thai.
2. Generate PostgreSQL migrations and deploy a staging environment.
3. Email delivery for password reset (e.g. Resend or SES adapter in `requestPasswordReset`).
4. Payment provider adapter (Omise/Stripe for web) using the sandbox.
5. Object-storage avatar uploads (S3/R2) with type and size validation.
6. Thai-language demo characters in the seed.

## Known limitations (usability round, 2026-10-12)

- Model prices are estimates from public list prices and the coin pack prices; review them before real payments go live.
- With the signup bonus (50) and daily bonus (10), a free user gets about 10 + 2 replies at 5 coins each.
- Gemini 3.8 Flash has only ~20 free requests per day; when it is used up, a cheaper model answers and the difference is refunded.
- Theme and text size are per device (cookies), not synced across devices; reply style and model are synced (stored on the account).
- Character notes row was not visually re-checked with real notes in this round (the test account had none).
