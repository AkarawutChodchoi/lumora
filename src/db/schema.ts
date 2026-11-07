// Postgres schema (Drizzle). Property names are what the code uses; the string
// passed to each column is the real snake_case column name in the database.
//
// Auth tables (user/session/account/verification/rateLimit/twoFactor) follow
// better-auth's expected shape — keep their property names as they are.
// Enum-like columns that change often (character visibility, report category …)
// are plain text validated with Zod in src/lib/domain/enums.ts; fixed state
// machines (roles, payments, ledger kinds) are Postgres enums, as in Alinmanga.

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Display preferences, mirrored in the `lumora_display` cookie so pages render without a flash. */
export type UserPrefs = { theme?: string; accent?: string; text?: string };

// ---------------- auth (better-auth) ----------------

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    /** avatar URL (an /api/images/<id> link or https://) */
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // app profile
    bio: text("bio").notNull().default(""),
    /** active | restricted | deletion_requested. Suspension is bannedAt (signs out everywhere). */
    status: text("status").notNull().default("active"),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    bannedReason: text("banned_reason"),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    ageConfirmed18: boolean("age_confirmed_18").notNull().default(false),
    matureContentEnabled: boolean("mature_content_enabled").notNull().default(false),
    memoryEnabled: boolean("memory_enabled").notNull().default(true),
    /** picked in the chat composer; null = deployment default */
    chatModel: text("chat_model"),
    /** concise | balanced | detailed */
    responseStyle: text("response_style").notNull().default("balanced"),
    prefs: jsonb("prefs").$type<UserPrefs>().notNull().default({}),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_created_idx").on(t.createdAt)],
);

/** TOTP secrets for 2FA (better-auth two-factor plugin); secret and backup codes are encrypted */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [index("two_factor_user_idx").on(t.userId), index("two_factor_secret_idx").on(t.secret)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** shared by better-auth (auth endpoints) and src/lib/server/rateLimit.ts ("app:" keys) */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ---------------- roles & audit ----------------

export const roleEnum = pgEnum("role", ["member", "moderator", "finance", "admin"]);

/** one user can hold several roles; everyone signed in is implicitly a member */
export const userRole = pgTable(
  "user_role",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/** who changed what and when — append only */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_target_idx").on(t.targetType, t.targetId), index("audit_actor_idx").on(t.actorId, t.createdAt), index("audit_created_idx").on(t.createdAt)],
);

// ---------------- characters ----------------

/** Uploaded pictures (portraits, avatars), resized in the browser before upload. */
export const image = pgTable(
  "image",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    bytes: bytea("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("image_owner_idx").on(t.ownerId)],
);

export const character = pgTable(
  "character",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tagline: text("tagline").notNull().default(""),
    description: text("description").notNull().default(""),
    avatarUrl: text("avatar_url"),
    personality: text("personality").notNull().default(""),
    backstory: text("backstory").notNull().default(""),
    scenario: text("scenario").notNull().default(""),
    greeting: text("greeting").notNull(),
    exampleDialogues: text("example_dialogues").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** primary category (first of `categories`) */
    category: text("category").notNull().default("other"),
    categories: text("categories").array().notNull().default(sql`'{}'::text[]`),
    /** private | unlisted | public */
    visibility: text("visibility").notNull().default("private"),
    /** draft | published | hidden | suspended */
    publicationStatus: text("publication_status").notNull().default("draft"),
    /** general | teen | mature */
    contentRating: text("content_rating").notNull().default("general"),
    currentVersion: integer("current_version").notNull().default(1),
    chatCount: integer("chat_count").notNull().default(0),
    favoriteCount: integer("favorite_count").notNull().default(0),
    featured: boolean("featured").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("character_owner_idx").on(t.ownerId),
    index("character_listing_idx").on(t.visibility, t.publicationStatus),
    index("character_category_idx").on(t.category),
  ],
);

/** Immutable snapshot of the prompt fields; conversations pin the version they started with. */
export const characterVersion = pgTable(
  "character_version",
  {
    id: id(),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("character_version_idx").on(t.characterId, t.version)],
);

export const favorite = pgTable(
  "favorite",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.characterId] })],
);

export const characterBlock = pgTable(
  "character_block",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.characterId] })],
);

// ---------------- chat ----------------

export const conversation = pgTable(
  "conversation",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    characterVersionId: text("character_version_id")
      .notNull()
      .references(() => characterVersion.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    /** active | archived */
    status: text("status").notNull().default("active"),
    nextSequence: integer("next_sequence").notNull().default(1),
    /** non-null while a reply is being generated (concurrency guard) */
    activeGenerationId: text("active_generation_id"),
    /** last message sequence reviewed by automatic memory */
    memoryScanSeq: integer("memory_scan_seq").notNull().default(0),
    /** short note the character writes about the latest chat */
    note: text("note"),
    noteAt: timestamp("note_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversation_user_recent_idx").on(t.userId, t.lastMessageAt)],
);

/** Append-only by sequence. Regenerate/edit deactivates the old row and appends a new one. */
export const message = pgTable(
  "message",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    /** user | assistant */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** pending | streaming | completed | failed | cancelled */
    status: text("status").notNull().default("completed"),
    isActive: boolean("is_active").notNull().default(true),
    replyToId: text("reply_to_id"),
    generationId: text("generation_id"),
    errorCode: text("error_code"),
    flagged: boolean("flagged").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("message_sequence_idx").on(t.conversationId, t.sequence), index("message_active_idx").on(t.conversationId, t.isActive, t.sequence)],
);

export const generation = pgTable(
  "generation",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    /** pending | streaming | cancel_requested | completed | failed | cancelled */
    status: text("status").notNull().default("pending"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costCoins: integer("cost_coins").notNull().default(0),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("generation_idempotency_idx").on(t.userId, t.idempotencyKey), index("generation_created_idx").on(t.createdAt)],
);

export const memory = pgTable(
  "memory",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversation.id, { onDelete: "set null" }),
    /** preference | relationship | episodic | world */
    type: text("type").notNull(),
    /** normalized slot, e.g. "user.name", used for conflict resolution */
    key: text("key"),
    content: text("content").notNull(),
    /** user_stated | ai_inferred | user_edited */
    source: text("source").notNull(),
    sourceMessageIds: text("source_message_ids").array().notNull().default(sql`'{}'::text[]`),
    confidence: doublePrecision("confidence").notNull().default(0.5),
    importance: integer("importance").notNull().default(3),
    supersededById: text("superseded_by_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("memory_scope_idx").on(t.userId, t.characterId)],
);

// ---------------- safety ----------------

export const report = pgTable(
  "report",
  {
    id: id(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** character | message | user */
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    category: text("category").notNull(),
    details: text("details").notNull().default(""),
    /** copy of the reported content at report time */
    snapshot: text("snapshot").notNull().default(""),
    /** low | medium | high | critical */
    severity: text("severity").notNull(),
    /** open | reviewing | actioned | dismissed */
    status: text("status").notNull().default("open"),
    resolvedById: text("resolved_by_id").references(() => user.id, { onDelete: "set null" }),
    resolutionNote: text("resolution_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("report_once_idx").on(t.reporterId, t.targetType, t.targetId), index("report_status_idx").on(t.status, t.severity)],
);

export const enforcement = pgTable(
  "enforcement",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** warning | restriction | suspension | reinstatement */
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("enforcement_user_idx").on(t.userId, t.createdAt)],
);

export const appeal = pgTable(
  "appeal",
  {
    id: id(),
    enforcementId: text("enforcement_id")
      .notNull()
      .references(() => enforcement.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    /** open | accepted | rejected */
    status: text("status").notNull().default("open"),
    decidedById: text("decided_by_id"),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("appeal_status_idx").on(t.status, t.createdAt)],
);

// ---------------- coins & payments ----------------
// Rules (same as Alinmanga): coins are only ever added by a gateway-confirmed payment,
// a rule-based grant (signup, daily, membership) or an admin adjustment with a reason;
// every change is a new coin_ledger row (never edited); `wallet` is the running balance,
// updated in the same transaction as the ledger row. `reference` is unique, so replaying
// the same operation can never move coins twice.

export const wallet = pgTable(
  "wallet",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    /** bought with money */
    paid: integer("paid").notNull().default(0),
    /** promotional (signup, daily, membership grants); spent first */
    bonus: integer("bonus").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [check("wallet_non_negative", sql`${t.paid} >= 0 and ${t.bonus} >= 0`)],
);

export const ledgerKindEnum = pgEnum("ledger_kind", ["topup", "bonus", "daily", "membership", "spend", "refund", "adjust", "clawback"]);

export const coinLedger = pgTable(
  "coin_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: ledgerKindEnum("kind").notNull(),
    paidDelta: integer("paid_delta").notNull().default(0),
    bonusDelta: integer("bonus_delta").notNull().default(0),
    /** balance (paid + bonus) right after this entry */
    balanceAfter: integer("balance_after").notNull(),
    /** what caused it: "signup:<u>", "daily:<u>:<day>", "gen:<id>:charge", payment id … */
    reference: text("reference").notNull(),
    note: text("note").notNull().default(""),
    /** staff member who made a manual adjustment */
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_user_idx").on(t.userId, t.createdAt), uniqueIndex("ledger_reference_idx").on(t.reference)],
);

export const paymentStatusEnum = pgEnum("payment_status", ["pending", "paid", "failed", "expired", "mismatch", "refunded"]);
export const paymentKindEnum = pgEnum("payment_kind", ["coins", "membership"]);

/** every payment attempt, whatever happened to it */
export const payment = pgTable(
  "payment",
  {
    /** our reference, shown to the user, e.g. PAY-20261107-8F3K2Q */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    kind: paymentKindEnum("kind").notNull().default("coins"),
    /** coin pack id or membership plan id */
    productId: text("product_id").notNull(),
    /** in satang (1 THB = 100), set on the server from the product, never from the browser */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("THB"),
    coins: integer("coins").notNull().default(0),
    bonus: integer("bonus").notNull().default(0),
    status: paymentStatusEnum("status").notNull().default("pending"),
    gateway: text("gateway").notNull(),
    gatewayChargeId: text("gateway_charge_id"),
    /** QR image URL or data URL to render */
    qr: text("qr"),
    failureReason: text("failure_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payment_gateway_charge_idx").on(t.gateway, t.gatewayChargeId),
    index("payment_user_idx").on(t.userId, t.createdAt),
    index("payment_status_idx").on(t.status, t.createdAt),
  ],
);

/** raw webhook deliveries, kept for auditing; (gateway, event_id) makes replays harmless */
export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    gateway: text("gateway").notNull(),
    eventId: text("event_id").notNull(),
    signatureOk: boolean("signature_ok").notNull(),
    payload: jsonb("payload").notNull(),
    result: text("result"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_event_once_idx").on(t.gateway, t.eventId)],
);

/** Lumora Plus periods. A paid period comes from a payment; staff grants have no payment. */
export const membership = pgTable(
  "membership",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull(),
    paymentId: text("payment_id")
      .unique()
      .references(() => payment.id),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("membership_user_idx").on(t.userId, t.endsAt)],
);

// ---------------- notifications & settings ----------------

export const notificationKindEnum = pgEnum("notification_kind", ["coins", "membership", "safety", "system"]);

export const notification = pgTable(
  "notification",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    text: text("text").notNull(),
    href: text("href").notNull().default("/"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt)],
);

/** Non-secret runtime settings editable by admins (model routing, limits, flags). */
export const siteSetting = pgTable("site_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});
