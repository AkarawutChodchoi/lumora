import "server-only";
import { and, asc, avg, count, desc, eq, gt, gte, ilike, inArray, isNotNull, lt, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { AppError, forbidden, notFound } from "./errors";
import { can, isStaff, STAFF_ROLES, type Role } from "@/lib/permissions";
import { ENFORCEMENT_ACTIONS, REPORT_STATUSES } from "@/lib/domain/enums";
import { audit } from "./audit";
import { applyEntry, verifyLedgerConsistency } from "./wallet";
import { eraseUser } from "./users";
import { revokeAllSessions } from "./auth";
import { notify } from "./notify";
import type { AppUser } from "./access";

const { user: userT, character, message, generation, payment, report, appeal, enforcement, userRole, membership, coinLedger, wallet } = schema;

// USD per million tokens (input, output). Used only for the dashboard's cost estimate.
const MODEL_PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export const rangeSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(7) });

const n = (q: Promise<{ v: number }[]>) => q.then((r) => Number(r[0]?.v ?? 0));
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

/** Overview metrics. Every number is computed from stored records for the stated window. */
export async function overview(days: number) {
  const since = new Date(Date.now() - days * 86400000);
  const [users, newUsers, activeUsers, characters, publicCharacters, messages, genByStatus, usage, revenue, openReports] = await Promise.all([
    n(db.select({ v: count() }).from(userT)),
    n(db.select({ v: count() }).from(userT).where(gte(userT.createdAt, since))),
    n(db.select({ v: count() }).from(userT).where(gte(userT.lastActiveAt, since))),
    n(db.select({ v: count() }).from(character)),
    n(db.select({ v: count() }).from(character).where(and(eq(character.visibility, "public"), eq(character.publicationStatus, "published")))),
    n(db.select({ v: count() }).from(message).where(and(gte(message.createdAt, since), eq(message.role, "user")))),
    db.select({ status: generation.status, c: count() }).from(generation).where(gte(generation.createdAt, since)).groupBy(generation.status),
    db
      .select({ model: generation.model, c: count(), input: sum(generation.inputTokens), output: sum(generation.outputTokens), latency: avg(generation.latencyMs) })
      .from(generation)
      .where(and(gte(generation.createdAt, since), eq(generation.status, "completed")))
      .groupBy(generation.model),
    db
      .select({ amount: sum(payment.amount), c: count() })
      .from(payment)
      .where(and(eq(payment.status, "paid"), gte(payment.paidAt, since))),
    n(db.select({ v: count() }).from(report).where(inArray(report.status, ["open", "reviewing"]))),
  ]);
  const statusCount = Object.fromEntries(genByStatus.map((g) => [g.status, g.c]));
  const byModel = usage.map((u) => {
    const price = u.model ? MODEL_PRICES[u.model] : undefined;
    const input = Number(u.input ?? 0);
    const output = Number(u.output ?? 0);
    return {
      model: u.model ?? "unknown",
      generations: u.c,
      inputTokens: input,
      outputTokens: output,
      avgLatencyMs: Math.round(Number(u.latency ?? 0)),
      estimatedCostUsd: price ? (input * price[0] + output * price[1]) / 1_000_000 : null,
    };
  });
  return {
    windowDays: days,
    since,
    users: { total: users, new: newUsers, active: activeUsers },
    characters: { total: characters, public: publicCharacters },
    userMessages: messages,
    generations: { completed: statusCount.completed ?? 0, failed: statusCount.failed ?? 0, cancelled: statusCount.cancelled ?? 0 },
    aiUsage: byModel,
    estimatedAiCostUsd: byModel.reduce((x, m) => x + (m.estimatedCostUsd ?? 0), 0),
    revenue: { amountMinor: Number(revenue[0]?.amount ?? 0), purchases: revenue[0]?.c ?? 0, currency: "THB" },
    openReports,
  };
}

// ---- Users ----

export const userSearchSchema = z.object({ q: z.string().trim().max(100).optional(), status: z.string().max(30).optional() });

async function rolesOf(ids: string[]) {
  if (!ids.length) return new Map<string, Role[]>();
  const rows = await db.select().from(userRole).where(inArray(userRole.userId, ids));
  const m = new Map<string, Role[]>();
  for (const r of rows) m.set(r.userId, [...(m.get(r.userId) ?? []), r.role]);
  return m;
}

const effectiveStatus = (u: { status: string; bannedAt: Date | null }) => (u.bannedAt ? "suspended" : u.status);

export async function searchUsers(q?: string, status?: string) {
  const pat = q ? `%${escapeLike(q)}%` : null;
  const rows = await db
    .select({ id: userT.id, email: userT.email, displayName: userT.name, status: userT.status, bannedAt: userT.bannedAt, twoFactorEnabled: userT.twoFactorEnabled, createdAt: userT.createdAt, lastActiveAt: userT.lastActiveAt, deletionRequestedAt: userT.deletionRequestedAt })
    .from(userT)
    .where(
      and(
        pat ? or(ilike(userT.email, pat), ilike(userT.name, pat), eq(userT.id, q!)) : undefined,
        status === "suspended" ? isNotNull(userT.bannedAt) : status ? eq(userT.status, status) : undefined,
      ),
    )
    .orderBy(desc(userT.createdAt))
    .limit(50);
  const roles = await rolesOf(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, status: effectiveStatus(r), roles: roles.get(r.id) ?? [] }));
}

/** Only the fields staff need. Conversations and memories are deliberately not exposed. */
export async function userDetail(id: string) {
  const [u] = await db.select().from(userT).where(eq(userT.id, id));
  if (!u) throw notFound("User");
  const [roles, [w], chars, convs, reportsFiled, enforcements, plus, ledger] = await Promise.all([
    rolesOf([id]),
    db.select().from(wallet).where(eq(wallet.userId, id)),
    n(db.select({ v: count() }).from(character).where(eq(character.ownerId, id))),
    n(db.select({ v: count() }).from(schema.conversation).where(eq(schema.conversation.userId, id))),
    n(db.select({ v: count() }).from(report).where(eq(report.reporterId, id))),
    db.select().from(enforcement).where(eq(enforcement.userId, id)).orderBy(desc(enforcement.createdAt)).limit(20),
    db.select({ endsAt: membership.endsAt }).from(membership).where(and(eq(membership.userId, id), gt(membership.endsAt, new Date()))).orderBy(desc(membership.endsAt)).limit(1),
    verifyLedgerConsistency(id),
  ]);
  return {
    id: u.id,
    email: u.email,
    displayName: u.name,
    status: effectiveStatus(u),
    bannedReason: u.bannedReason,
    twoFactorEnabled: u.twoFactorEnabled,
    roles: roles.get(id) ?? [],
    createdAt: u.createdAt,
    lastActiveAt: u.lastActiveAt,
    deletionRequestedAt: u.deletionRequestedAt,
    wallet: { paid: w?.paid ?? 0, bonus: w?.bonus ?? 0 },
    plusUntil: plus[0]?.endsAt ?? null,
    counts: { characters: chars, conversations: convs, reportsFiled },
    enforcements,
    ledger,
  };
}

export const enforceSchema = z.object({
  action: z.enum(ENFORCEMENT_ACTIONS),
  reason: z.string().trim().min(5, "Give a reason (min 5 characters)").max(1000),
  expiresAt: z.string().datetime().optional(),
});

async function loadTarget(id: string) {
  const [t] = await db.select().from(userT).where(eq(userT.id, id));
  if (!t) throw notFound("User");
  const roles = (await rolesOf([id])).get(id) ?? [];
  return { ...t, roles };
}

/** Services re-check permissions themselves, so a missed route guard can't open them up. */
function need(actor: AppUser, p: Parameters<typeof can>[1]) {
  if (!can(actor.roles, p)) throw forbidden();
}

export async function enforce(actor: AppUser, userId: string, input: z.infer<typeof enforceSchema>) {
  need(actor, "users.enforce");
  const target = await loadTarget(userId);
  if (target.id === actor.id) throw forbidden("You cannot take action on your own account");
  if (isStaff(target.roles) && !actor.roles.includes("admin")) throw forbidden("Only admins can take action on staff accounts");
  if (target.roles.includes("admin") && input.action === "suspension") throw forbidden("Remove the admin role before suspending this account");
  await db.transaction(async (tx) => {
    await tx.insert(enforcement).values({ userId, action: input.action, reason: input.reason, actorId: actor.id, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null });
    if (input.action === "restriction") await tx.update(userT).set({ status: "restricted" }).where(eq(userT.id, userId));
    if (input.action === "suspension") await tx.update(userT).set({ bannedAt: new Date(), bannedReason: input.reason }).where(eq(userT.id, userId));
    if (input.action === "reinstatement") await tx.update(userT).set({ status: "active", bannedAt: null, bannedReason: null }).where(eq(userT.id, userId));
    await audit({ actorId: actor.id, action: `user.${input.action}`, targetType: "user", targetId: userId, details: { reason: input.reason } }, tx);
    await notify([userId], "safety", input.action === "reinstatement" ? "บัญชีของคุณกลับมาใช้งานได้ตามปกติแล้ว" : `บัญชีของคุณได้รับ${input.action === "warning" ? "คำเตือน" : "การจำกัดการใช้งาน"} ดูรายละเอียดที่ศูนย์ความปลอดภัย`, "/safety", tx);
  });
  // A suspension signs the user out everywhere.
  if (input.action === "suspension") await revokeAllSessions(userId);
}

export async function processDeletion(actor: AppUser, userId: string) {
  need(actor, "users.process_deletion");
  const target = await loadTarget(userId);
  if (target.status !== "deletion_requested") throw new AppError("conflict", "This user has not requested deletion");
  await eraseUser(userId, actor.id);
}

export const roleSchema = z.object({ role: z.enum(STAFF_ROLES), grant: z.boolean(), reason: z.string().trim().min(3).max(500) });

/** Grant or remove one staff role. Admin only; nobody can change their own roles (no lock-out). */
export async function setRole(actor: AppUser, userId: string, input: z.infer<typeof roleSchema>) {
  if (!can(actor.roles, "users.manage_roles")) throw forbidden();
  if (actor.id === userId) throw forbidden("You cannot take action on your own account");
  const target = await loadTarget(userId);
  if (target.bannedAt && input.grant) throw new AppError("conflict", "Reinstate this account before granting a staff role");
  await db.transaction(async (tx) => {
    if (input.grant) await tx.insert(userRole).values({ userId, role: input.role, grantedBy: actor.id }).onConflictDoNothing();
    else await tx.delete(userRole).where(and(eq(userRole.userId, userId), eq(userRole.role, input.role)));
    await audit({ actorId: actor.id, action: input.grant ? "user.role_granted" : "user.role_removed", targetType: "user", targetId: userId, details: { before: target.roles, after: { role: input.role, grant: input.grant }, reason: input.reason } }, tx);
  });
  // privileges changed: make every device sign in again
  await revokeAllSessions(userId);
}

export const premiumSchema = z.object({ days: z.number().int().min(0).max(3650), reason: z.string().trim().min(3).max(500) });

/**
 * Grant (days > 0) or end (days = 0) Lumora Plus without payment. Recorded as a
 * membership with `grantedBy` and no payment, so it is clearly distinguishable from paid ones.
 */
export async function setPremium(actor: AppUser, userId: string, input: z.infer<typeof premiumSchema>) {
  if (!can(actor.roles, "users.grant_premium")) throw forbidden();
  await loadTarget(userId);
  const now = new Date();
  await db.transaction(async (tx) => {
    if (input.days === 0) {
      await tx
        .update(membership)
        .set({ endsAt: now })
        .where(and(eq(membership.userId, userId), gt(membership.endsAt, now)));
    } else {
      await tx.insert(membership).values({ userId, planId: "staff_grant", grantedBy: actor.id, startsAt: now, endsAt: new Date(now.getTime() + input.days * 86400000) });
    }
    await audit({ actorId: actor.id, action: input.days ? "user.premium_granted" : "user.premium_ended", targetType: "user", targetId: userId, details: { after: { days: input.days }, reason: input.reason } }, tx);
  });
}

/** Sign a user out of every device. */
export async function forceSignOut(actor: AppUser, userId: string) {
  if (!can(actor.roles, "users.enforce")) throw forbidden();
  await revokeAllSessions(userId);
  await audit({ actorId: actor.id, action: "user.signed_out_everywhere", targetType: "user", targetId: userId });
}

/** Permanently erase another account right away (admin only, never self or another admin). */
export async function eraseNow(actor: AppUser, userId: string, confirmEmail: string) {
  if (!can(actor.roles, "users.erase")) throw forbidden();
  if (actor.id === userId) throw forbidden("You cannot take action on your own account");
  const target = await loadTarget(userId);
  if (target.roles.includes("admin")) throw forbidden("Admins cannot be erased from the dashboard");
  if (confirmEmail.trim().toLowerCase() !== target.email) throw new AppError("validation_failed", "Type the account email exactly to confirm");
  await eraseUser(userId, actor.id);
}

/** Open reports + open appeals, for the staff badge. */
export async function staffInbox() {
  const [reports, appeals] = await Promise.all([
    n(db.select({ v: count() }).from(report).where(inArray(report.status, ["open", "reviewing"]))),
    n(db.select({ v: count() }).from(appeal).where(eq(appeal.status, "open"))),
  ]);
  return { reports, appeals, total: reports + appeals };
}

// ---- Characters ----

export const characterModerationSchema = z.object({
  action: z.enum(["approve", "hide", "suspend", "restore", "feature", "unfeature"]),
  reason: z.string().trim().min(3).max(1000),
});

export async function searchAllCharacters(q?: string, status?: string) {
  const pat = q ? `%${escapeLike(q)}%` : null;
  const rows = await db
    .select({
      id: character.id,
      name: character.name,
      tagline: character.tagline,
      visibility: character.visibility,
      publicationStatus: character.publicationStatus,
      contentRating: character.contentRating,
      featured: character.featured,
      chatCount: character.chatCount,
      currentVersion: character.currentVersion,
      updatedAt: character.updatedAt,
      ownerId: userT.id,
      ownerName: userT.name,
    })
    .from(character)
    .innerJoin(userT, eq(userT.id, character.ownerId))
    .where(and(pat ? or(ilike(character.name, pat), eq(character.id, q!), eq(character.ownerId, q!)) : undefined, status ? eq(character.publicationStatus, status) : undefined))
    .orderBy(desc(character.updatedAt))
    .limit(50);
  return rows.map(({ ownerId, ownerName, ...c }) => ({ ...c, owner: { id: ownerId, displayName: ownerName } }));
}

export async function moderateCharacter(actor: AppUser, id: string, input: z.infer<typeof characterModerationSchema>) {
  need(actor, "characters.moderate");
  const [c] = await db.select().from(character).where(eq(character.id, id));
  if (!c) throw notFound("Character");
  const data: Partial<typeof character.$inferInsert> =
    input.action === "approve" || input.action === "restore"
      ? { publicationStatus: c.visibility === "private" ? "draft" : "published" }
      : input.action === "hide"
        ? { publicationStatus: "hidden", featured: false }
        : input.action === "suspend"
          ? { publicationStatus: "suspended", featured: false }
          : { featured: input.action === "feature" };
  await db.transaction(async (tx) => {
    await tx.update(character).set(data).where(eq(character.id, id));
    await audit({ actorId: actor.id, action: `character.${input.action}`, targetType: "character", targetId: id, details: { before: { publicationStatus: c.publicationStatus, featured: c.featured }, after: data, reason: input.reason } }, tx);
  });
}

// ---- Reports and appeals ----

export async function listReports(status?: string) {
  const rows = await db
    .select({ r: report, reporterName: userT.name })
    .from(report)
    .innerJoin(userT, eq(userT.id, report.reporterId))
    .where(status ? eq(report.status, status) : inArray(report.status, ["open", "reviewing"]))
    .orderBy(desc(report.createdAt))
    .limit(100);
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
  return rows.map(({ r, reporterName }) => ({ ...r, reporter: { id: r.reporterId, displayName: reporterName } })).sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}

export const resolveReportSchema = z.object({ status: z.enum(REPORT_STATUSES), note: z.string().trim().max(1000).default("") });

export async function resolveReport(actor: AppUser, id: string, input: z.infer<typeof resolveReportSchema>) {
  need(actor, "reports.review");
  const [r] = await db.select().from(report).where(eq(report.id, id));
  if (!r) throw notFound("Report");
  await db.transaction(async (tx) => {
    await tx.update(report).set({ status: input.status, resolutionNote: input.note || null, resolvedById: actor.id }).where(eq(report.id, id));
    await audit({ actorId: actor.id, action: `report.${input.status}`, targetType: "report", targetId: id, details: { reason: input.note } }, tx);
  });
}

export async function listAppeals() {
  const rows = await db
    .select({ a: appeal, e: enforcement, u: { id: userT.id, displayName: userT.name, status: userT.status, bannedAt: userT.bannedAt } })
    .from(appeal)
    .innerJoin(enforcement, eq(enforcement.id, appeal.enforcementId))
    .innerJoin(userT, eq(userT.id, appeal.userId))
    .where(eq(appeal.status, "open"))
    .orderBy(asc(appeal.createdAt));
  return rows.map(({ a, e, u }) => ({ ...a, enforcement: e, user: { id: u.id, displayName: u.displayName, status: effectiveStatus(u) } }));
}

export const decideAppealSchema = z.object({ decision: z.enum(["accepted", "rejected"]), note: z.string().trim().min(3).max(1000) });

export async function decideAppeal(actor: AppUser, id: string, input: z.infer<typeof decideAppealSchema>) {
  need(actor, "appeals.decide");
  const [row] = await db.select({ a: appeal, e: enforcement }).from(appeal).innerJoin(enforcement, eq(enforcement.id, appeal.enforcementId)).where(eq(appeal.id, id));
  if (!row) throw notFound("Appeal");
  if (row.a.status !== "open") throw new AppError("conflict", "This appeal was already decided");
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(appeal)
      .set({ status: input.decision, decidedById: actor.id, decisionNote: input.note })
      .where(and(eq(appeal.id, id), eq(appeal.status, "open")))
      .returning({ id: appeal.id });
    if (!claimed.length) throw new AppError("conflict", "This appeal was already decided");
    if (input.decision === "accepted" && row.e.action !== "warning") {
      await tx.update(userT).set({ status: "active", bannedAt: null, bannedReason: null }).where(eq(userT.id, row.a.userId));
      await tx.insert(enforcement).values({ userId: row.a.userId, action: "reinstatement", reason: `Appeal accepted: ${input.note}`, actorId: actor.id });
    }
    await audit({ actorId: actor.id, action: `appeal.${input.decision}`, targetType: "appeal", targetId: id, details: { reason: input.note } }, tx);
    await notify([row.a.userId], "safety", input.decision === "accepted" ? "คำอุทธรณ์ของคุณได้รับการอนุมัติ" : "คำอุทธรณ์ของคุณไม่ได้รับการอนุมัติ", "/safety", tx);
  });
}

// ---- Billing ----

export const adjustSchema = z.object({
  userId: z.string().min(1).max(60),
  delta: z.number().int().min(-100000).max(100000).refine((x) => x !== 0, "Amount cannot be zero"),
  /** credits only: which bucket. Deductions always take bonus first. */
  bucket: z.enum(["paid", "bonus"]).default("bonus"),
  reason: z.string().trim().min(5).max(500),
  requestId: z.string().min(8).max(64),
});

/** Every balance change goes through the ledger; there is no direct balance edit. */
export async function adjustCredits(actor: AppUser, input: z.infer<typeof adjustSchema>) {
  if (!can(actor.roles, "billing.adjust")) throw forbidden();
  await loadTarget(input.userId);
  return db.transaction(async (tx) => {
    const { entry, replayed } = await applyEntry(tx, {
      userId: input.userId,
      kind: "adjust",
      amount: input.delta,
      bucket: input.bucket,
      reference: `admin:${actor.id}:${input.requestId}`,
      actorId: actor.id,
      note: input.reason,
    });
    if (!replayed) {
      await audit({ actorId: actor.id, action: "billing.adjust", targetType: "user", targetId: input.userId, details: { after: { delta: input.delta, bucket: input.bucket, ledgerId: entry.id }, reason: input.reason } }, tx);
    }
    return entry;
  });
}

export async function billingSnapshot(userId?: string) {
  const ledger = await db
    .select({ l: coinLedger, name: userT.name })
    .from(coinLedger)
    .innerJoin(userT, eq(userT.id, coinLedger.userId))
    .where(userId ? eq(coinLedger.userId, userId) : undefined)
    .orderBy(desc(coinLedger.id))
    .limit(100);
  const memberships = await db
    .select()
    .from(membership)
    .where(userId ? eq(membership.userId, userId) : undefined)
    .orderBy(desc(membership.createdAt))
    .limit(50);
  return {
    ledger: ledger.map(({ l, name }) => ({ ...l, id: String(l.id), delta: l.paidDelta + l.bonusDelta, user: { displayName: name } })),
    memberships: memberships.map((m) => ({ ...m, id: String(m.id) })),
  };
}

/** Simple anomaly signals for review; not automatic enforcement. */
export async function billingAnomalies() {
  const hourAgo = new Date(Date.now() - 3600000);
  const [heavy, bigAdjustments, accounts, stuck] = await Promise.all([
    db
      .select({ userId: coinLedger.userId, charges: count() })
      .from(coinLedger)
      .where(and(eq(coinLedger.kind, "spend"), gte(coinLedger.createdAt, hourAgo)))
      .groupBy(coinLedger.userId)
      .having(sql`count(*) > 200`),
    db
      .select()
      .from(coinLedger)
      .where(and(eq(coinLedger.kind, "adjust"), or(gt(sql`${coinLedger.paidDelta} + ${coinLedger.bonusDelta}`, 5000), lt(sql`${coinLedger.paidDelta} + ${coinLedger.bonusDelta}`, -5000))))
      .orderBy(desc(coinLedger.id))
      .limit(20),
    db.select({ userId: wallet.userId }).from(wallet).orderBy(desc(wallet.updatedAt)).limit(500),
    db.select().from(payment).where(eq(payment.status, "mismatch")).orderBy(desc(payment.createdAt)).limit(50),
  ]);
  const inconsistent = [];
  for (const a of accounts) {
    const c = await verifyLedgerConsistency(a.userId);
    if (!c.consistent) inconsistent.push({ userId: a.userId, ...c });
  }
  return {
    heavyUsageLastHour: heavy,
    largeAdjustments: bigAdjustments.map((l) => ({ ...l, id: String(l.id), delta: l.paidDelta + l.bonusDelta })),
    negativeOrInconsistent: inconsistent,
    mismatchedPayments: stuck.map((p) => ({ id: p.id, userId: p.userId, amount: p.amount / 100, reason: p.failureReason, createdAt: p.createdAt })),
  };
}

export async function listAudit(take = 100) {
  const rows = await db
    .select({ a: schema.auditLog, actorName: userT.name })
    .from(schema.auditLog)
    .leftJoin(userT, eq(userT.id, schema.auditLog.actorId))
    .orderBy(desc(schema.auditLog.id))
    .limit(take);
  return rows.map(({ a, actorName }) => ({ ...a, id: String(a.id), actorName }));
}
