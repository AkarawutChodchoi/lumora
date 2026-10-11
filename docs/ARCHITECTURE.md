# Lumora AI — Architecture

## Decisions

| Topic | Spec suggestion | What we built | Why |
|---|---|---|---|
| Client | Flutter mobile apps | Responsive web app (mobile-first, with bottom nav) | One codebase that runs on phones, tablets and desktop. Flutter would need a second codebase and store accounts, and it can be added later against the same API |
| Backend | NestJS | Next.js route handlers plus a service layer (`src/server/services`) | One TypeScript project. Business logic lives in framework-free services, so moving to NestJS later means moving controllers, not logic |
| Database | PostgreSQL | Prisma with SQLite in dev and PostgreSQL in prod | No local database install is needed to develop. Enum-like columns are strings validated with Zod because SQLite has no enums |
| Cache/queue | Redis when needed | Not used yet | The single-instance rate limiter is in-memory. Swap in Redis before horizontal scaling |
| Media | S3 storage | `https://` image URLs, with a generated gradient portrait as fallback | Object storage needs credentials. Uploads are listed as pending in CHECKLIST |

Where specs conflicted (e.g. Prompt 00 "stop for approval" vs. the master prompt "keep going"), we prioritised security and correctness and confirmed scope with the owner before starting.

## Request flow

```
Browser ──► middleware (guest redirect for private pages; Origin check on API writes)
        ──► Server Components ──► services ──► Prisma
        ──► /api/* route handlers ──► Zod validation ──► guards (requireUser / requirePermission) ──► services
```

All authorization happens on the server, in services or guards. The client never sends prices, balances, roles, ownership or entitlements, and nothing it sends is used to decide them.

## Data model (summary)

See `prisma/schema.prisma` (commented).

- **User**: role (`user|moderator|admin`), status (`active|restricted|suspended|deletion_requested`), age/mature flags, memory toggle.
- **Session**: HMAC-hashed token, fixed 30-day expiry, revocable. **PasswordResetToken**: hashed, 30 minutes, single use.
- **Character**: `visibility` (private/unlisted/public) × `publicationStatus` (draft/published/hidden/suspended) × `contentRating`.
- **CharacterVersion**: an immutable snapshot of prompt fields. A new version is created only when prompt fields change.
- **Conversation**: pinned to `characterVersionId`, holds `activeGenerationId` (concurrency lock) and `nextSequence`.
- **Message**: append-only `sequence`. `isActive=false` hides replaced variants (regenerate/edit) without breaking order.
- **Generation**: one row per AI call. Holds the idempotency key, model, real provider token usage, latency, status and cost.
- **Memory**: user × character scoped, with type, slot `key`, source/provenance, confidence, importance, `supersededById`, `expiresAt`.
- **CreditAccount + CreditLedger**: the balance plus an append-only ledger with unique idempotency keys.
- **Purchase, PaymentEvent, SubscriptionRecord**: payment-side records. Events are unique per `(provider, eventId)`.
- **Report, Enforcement, Appeal, AuditLog, AppSetting**: moderation records, the audit log and admin-editable settings.

## Chat message lifecycle

1. `POST /api/conversations/:id/messages` with `{mode: send|regenerate|edit, clientRequestId}`.
2. **prepare** (before streaming, so failures come back as normal JSON errors): ownership check → status/character checks → input moderation → route model by entitlement → take the conversation lock (`UPDATE … WHERE activeGenerationId IS NULL`; stale locks over 5 minutes are reclaimed) → one transaction that creates the Generation (unique `userId+clientRequestId` rejects duplicates), the user message, the assistant placeholder (`pending`) and the coin charge (`gen:<id>:charge`).
3. **run**: explicit memories are extracted from the user message → the prompt is assembled → the provider streams → SSE events `start / delta / done | error`. Partial text is saved about every 800 ms. Cancel requests are polled from the DB every second, so cancelling works across instances.
4. **finish**: output moderation → message `completed` and generation `completed` with provider usage → lock released.
   - Failure or refusal: message `failed`, refund (`gen:<id>:refund`, idempotent), lock released.
   - Cancel: message `cancelled`. Free if no text was produced yet.
   - **Client disconnect** does not cancel. Generation finishes and is saved, and the UI re-syncs from the server.

Regeneration policy: the old reply is kept (inactive) and the new reply is appended. Edit: only the latest user message can be edited. It and its reply are deactivated and replaced.

Character versions: existing chats keep the version they started with, and new chats use the latest version.

## AI engine (`src/server/ai`)

- `types.ts`: `AIProvider`, `GenerateRequest`, `StreamEvent`, `TokenUsage`, and `ProviderError` (kinds: authentication, rate_limit, timeout, content_policy, provider, invalid_request, cancelled). Error messages are safe to show users.
- `providers/anthropic.ts`: official SDK, `beta.messages.stream`, system blocks with prompt caching on the stable prefix, `output_config.effort`, and server-side refusal fallback (`fallbacks: "default"`) on models that support it. SDK retries cover transient 429/5xx before the stream starts. Usage includes cache read/creation tokens.
- `providers/dev.ts`: labelled placeholder, never presented as AI. `__dev_fail__` simulates a provider failure.
- `registry.ts`: provider selection plus model routing by entitlement tier. Tests inject a mock provider. **Adding a provider = one adapter file + one line in `getProvider`**, with no change to the chat service.
- `prompt.ts`: assembles in this fixed order: system policy → `<character>` → `<scenario>` → `<memories>` → history → latest message. Everything after the policy is user-generated, tag-escaped and declared to be data. A token budget fills history newest-first, so the latest message is always kept. The memory section has its own budget.
- `tokens.ts`: a conservative estimate used only for budgeting (Thai is weighted heavier). Billing and metrics use provider-reported usage only.

## Memory

Pipeline: rule-based extraction of **explicit** statements (EN + TH: name, pronouns, likes/dislikes, favorites, birthday, "remember that…") → sensitive-data filter (cards, Thai ID numbers, passwords) → dedupe by exact content → conflict resolution by slot key (the newest explicit statement wins, the old one is kept as `supersededById` for provenance) → per-plan limit (lowest importance and oldest expire first) → retrieval scored by importance, keyword overlap, recency and confidence, within a token budget.

- Isolation: every query is scoped by `(userId, characterId)`. Tested.
- Episodic memories expire after 180 days. Users can view, add, edit, delete or clear memories and can switch extraction off.
- The model never stores inferred guesses as facts. LLM-based inference (`ai_inferred`, lower confidence, labelled "inferred" in prompts) and vector search are planned extensions, to add when quality data justifies them.

## Coins & entitlements

- Every balance change is a ledger row in the same transaction as the balance update. Spending uses a conditional atomic decrement (`balance >= cost`), so concurrent requests cannot overdraw. Tested with 12 parallel spends against 5 coins.
- Idempotency keys: `signup:<user>`, `daily:<user>:<date>`, `gen:<id>:charge|refund`, `purchase:<provider>:<ref>`, `subgrant:<provider>:<ref>:<periodEnd>`, `admin:<actor>:<requestId>`.
- Entitlements (`modelTier`, `monthlyCreditAllowance`, `memoryLimit`, `features`) are derived from verified `SubscriptionRecord`s and `PLANS` in `domain/catalog.ts`, never from the client.
- The webhook verifies an HMAC signature with a 5-minute tolerance, inserts the event first (duplicates are rejected by a unique key), checks amounts against the catalog price, then applies the effect atomically.

## Security controls

| Threat | Control |
|---|---|
| Password theft | Argon2id (19 MiB, t=2). Timing equalised for unknown emails. Generic login errors |
| Session theft/forgery | 256-bit random tokens. Only an HMAC (keyed by `SESSION_SECRET`) is stored. httpOnly, SameSite=Lax, Secure in prod. Revoked on logout, password change and suspension |
| CSRF | SameSite cookies plus an Origin/Sec-Fetch-Site check on all non-GET API calls |
| IDOR | Every resource is loaded with an owner/visibility check. Another user's private data returns 404 (not 403) to avoid revealing it exists |
| Brute force / abuse | Rate limits on register, login (per IP and per account), reset, chat, reports, appeals and character creation |
| Injection | Prisma parameterised queries. React escaping (no `dangerouslySetInnerHTML`). Zod on every input |
| Prompt injection | Policy-first prompt, tag escaping, untrusted data declared as data, flag metrics. Character prompts are hidden from non-owners |
| Secret leakage | Keys only in env. Logger redacts secret-like keys. No message content in logs. Admin settings store no secrets |
| Clickjacking etc. | `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a permissions policy |

## Roles & permissions

`src/server/domain/permissions.ts`. Code checks permissions, never role names.

| Permission | moderator | admin |
|---|---|---|
| admin.view, users.view, users.enforce, characters.moderate, reports.review, appeals.decide, audit.view | ✓ | ✓ |
| users.process_deletion, billing.view, billing.adjust, ai.configure | | ✓ |

Moderators cannot act on staff accounts, and nobody can act on their own account. Every privileged action writes an AuditLog row with a reason.
