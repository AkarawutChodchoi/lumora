import type { Prisma, User } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { AppError, forbidden, notFound } from "../errors";
import { can } from "../domain/permissions";
import { ENFORCEMENT_ACTIONS, REPORT_STATUSES } from "../domain/enums";
import { audit } from "./audit";
import { applyLedgerEntry, verifyLedgerConsistency } from "./credits";
import { eraseUser } from "./users";
import { revokeAllSessions } from "../auth/session";

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

/** Overview metrics. Every number is computed from stored records for the stated window. */
export async function overview(days: number) {
  const since = new Date(Date.now() - days * 86400000);
  const [users, newUsers, activeUsers, characters, publicCharacters, messages, genByStatus, usage, revenue, openReports] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: since } } }),
    db.user.count({ where: { lastActiveAt: { gte: since } } }),
    db.character.count(),
    db.character.count({ where: { visibility: "public", publicationStatus: "published" } }),
    db.message.count({ where: { createdAt: { gte: since }, role: "user" } }),
    db.generation.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.generation.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since }, status: "completed" },
      _sum: { inputTokens: true, outputTokens: true },
      _avg: { latencyMs: true },
      _count: { _all: true },
    }),
    db.purchase.aggregate({ where: { createdAt: { gte: since }, status: "completed" }, _sum: { amountMinor: true }, _count: { _all: true } }),
    db.report.count({ where: { status: { in: ["open", "reviewing"] } } }),
  ]);
  const statusCount = Object.fromEntries(genByStatus.map((g) => [g.status, g._count._all]));
  const byModel = usage.map((u) => {
    const price = u.model ? MODEL_PRICES[u.model] : undefined;
    const input = u._sum.inputTokens ?? 0;
    const output = u._sum.outputTokens ?? 0;
    return {
      model: u.model ?? "unknown",
      generations: u._count._all,
      inputTokens: input,
      outputTokens: output,
      avgLatencyMs: Math.round(u._avg.latencyMs ?? 0),
      estimatedCostUsd: price ? (input * price[0] + output * price[1]) / 1_000_000 : null,
    };
  });
  return {
    windowDays: days,
    since,
    users: { total: users, new: newUsers, active: activeUsers },
    characters: { total: characters, public: publicCharacters },
    userMessages: messages,
    generations: {
      completed: statusCount.completed ?? 0,
      failed: statusCount.failed ?? 0,
      cancelled: statusCount.cancelled ?? 0,
    },
    aiUsage: byModel,
    estimatedAiCostUsd: byModel.reduce((n, m) => n + (m.estimatedCostUsd ?? 0), 0),
    revenue: { amountMinor: revenue._sum.amountMinor ?? 0, purchases: revenue._count._all, currency: "THB" },
    openReports,
  };
}

// ---- Users ----

export const userSearchSchema = z.object({ q: z.string().trim().max(100).optional(), status: z.string().max(30).optional() });

export async function searchUsers(q?: string, status?: string) {
  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { displayName: { contains: q, mode: "insensitive" } }, { id: q }] } : {}),
    ...(status ? { status } : {}),
  };
  return db.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, email: true, displayName: true, role: true, status: true, createdAt: true, lastActiveAt: true, deletionRequestedAt: true },
  });
}

/** Only the fields staff need. Conversations and memories are deliberately not exposed. */
export async function userDetail(id: string) {
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      createdAt: true,
      lastActiveAt: true,
      deletionRequestedAt: true,
      creditAccount: { select: { balance: true } },
      _count: { select: { characters: true, conversations: true, reportsFiled: true } },
      enforcements: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!u) throw notFound("User");
  const ledger = await verifyLedgerConsistency(id);
  return { ...u, ledger };
}

export const enforceSchema = z.object({
  action: z.enum(ENFORCEMENT_ACTIONS),
  reason: z.string().trim().min(5, "Give a reason (min 5 characters)").max(1000),
  expiresAt: z.string().datetime().optional(),
});

const STATUS_FOR_ACTION = { warning: null, restriction: "restricted", suspension: "suspended", reinstatement: "active" } as const;

export async function enforce(actor: User, userId: string, input: z.infer<typeof enforceSchema>) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound("User");
  if (target.id === actor.id) throw forbidden("You cannot take action on your own account");
  if (target.role !== "user" && actor.role !== "admin") throw forbidden("Only admins can take action on staff accounts");
  const status = STATUS_FOR_ACTION[input.action];
  await db.$transaction(async (tx) => {
    await tx.enforcement.create({
      data: { userId, action: input.action, reason: input.reason, actorId: actor.id, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null },
    });
    if (status) await tx.user.update({ where: { id: userId }, data: { status } });
    await audit({ actorId: actor.id, action: `user.${input.action}`, targetType: "user", targetId: userId, details: { reason: input.reason } }, tx);
  });
  if (input.action === "suspension") await revokeAllSessions(userId);
}

export async function processDeletion(actor: User, userId: string) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound("User");
  if (target.status !== "deletion_requested") throw new AppError("conflict", "This user has not requested deletion");
  await eraseUser(userId, actor.id);
}

export const roleSchema = z.object({ role: z.enum(["user", "moderator", "admin"]), reason: z.string().trim().min(3).max(500) });

/** Change a user's role. Admin only; nobody can change their own role. */
export async function setRole(actor: User, userId: string, input: z.infer<typeof roleSchema>) {
  if (!can(actor.role, "users.manage_roles")) throw forbidden();
  if (actor.id === userId) throw forbidden("You cannot take action on your own account");
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound("User");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role: input.role } });
    await audit({ actorId: actor.id, action: "user.role_changed", targetType: "user", targetId: userId, details: { from: target.role, to: input.role, reason: input.reason } }, tx);
  });
}

export const premiumSchema = z.object({ days: z.number().int().min(0).max(3650), reason: z.string().trim().min(3).max(500) });

/**
 * Grant (days > 0) or end (days = 0) Lumora Plus without payment. Recorded as an
 * "admin" subscription so it is clearly distinguishable from paid ones.
 */
export async function setPremium(actor: User, userId: string, input: z.infer<typeof premiumSchema>) {
  if (!can(actor.role, "users.grant_premium")) throw forbidden();
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) throw notFound("User");
  const now = new Date();
  await db.$transaction(async (tx) => {
    if (input.days === 0) {
      await tx.subscriptionRecord.updateMany({ where: { userId, currentPeriodEnd: { gt: now }, status: { in: ["active", "cancelled"] } }, data: { status: "expired", currentPeriodEnd: now } });
    } else {
      await tx.subscriptionRecord.create({
        data: { userId, planId: "premium", status: "active", provider: "admin", providerRef: `admin:${randomUUID()}`, currentPeriodEnd: new Date(now.getTime() + input.days * 86400000) },
      });
    }
    await audit({ actorId: actor.id, action: input.days ? "user.premium_granted" : "user.premium_ended", targetType: "user", targetId: userId, details: { days: input.days, reason: input.reason } }, tx);
  });
}

/** Sign a user out of every device. */
export async function forceSignOut(actor: User, userId: string) {
  if (!can(actor.role, "users.enforce")) throw forbidden();
  await revokeAllSessions(userId);
  await audit({ actorId: actor.id, action: "user.signed_out_everywhere", targetType: "user", targetId: userId });
}

/** Permanently erase another account right away (admin only, never self or another admin). */
export async function eraseNow(actor: User, userId: string, confirmEmail: string) {
  if (!can(actor.role, "users.erase")) throw forbidden();
  if (actor.id === userId) throw forbidden("You cannot take action on your own account");
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound("User");
  if (target.role === "admin") throw forbidden("Admins cannot be erased from the dashboard");
  if (confirmEmail.trim().toLowerCase() !== target.email) throw new AppError("validation_failed", "Type the account email exactly to confirm");
  await eraseUser(userId, actor.id);
}

/** Open reports + open appeals, for the staff badge. */
export async function staffInbox() {
  const [reports, appeals] = await Promise.all([
    db.report.count({ where: { status: { in: ["open", "reviewing"] } } }),
    db.appeal.count({ where: { status: "open" } }),
  ]);
  return { reports, appeals, total: reports + appeals };
}

// ---- Characters ----

export const characterModerationSchema = z.object({
  action: z.enum(["approve", "hide", "suspend", "restore", "feature", "unfeature"]),
  reason: z.string().trim().min(3).max(1000),
});

export async function searchAllCharacters(q?: string, status?: string) {
  return db.character.findMany({
    where: {
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { id: q }, { ownerId: q }] } : {}),
      ...(status ? { publicationStatus: status } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true, name: true, tagline: true, visibility: true, publicationStatus: true, contentRating: true, featured: true,
      chatCount: true, currentVersion: true, updatedAt: true, owner: { select: { id: true, displayName: true } },
    },
  });
}

export async function moderateCharacter(actor: User, id: string, input: z.infer<typeof characterModerationSchema>) {
  const c = await db.character.findUnique({ where: { id } });
  if (!c) throw notFound("Character");
  const data: Prisma.CharacterUpdateInput =
    input.action === "approve" || input.action === "restore"
      ? { publicationStatus: c.visibility === "private" ? "draft" : "published" }
      : input.action === "hide"
        ? { publicationStatus: "hidden", featured: false }
        : input.action === "suspend"
          ? { publicationStatus: "suspended", featured: false }
          : { featured: input.action === "feature" };
  await db.$transaction(async (tx) => {
    await tx.character.update({ where: { id }, data });
    await audit({ actorId: actor.id, action: `character.${input.action}`, targetType: "character", targetId: id, details: { reason: input.reason } }, tx);
  });
}

// ---- Reports and appeals ----

export async function listReports(status?: string) {
  const reports = await db.report.findMany({
    where: status ? { status } : { status: { in: ["open", "reviewing"] } },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
    include: { reporter: { select: { id: true, displayName: true } } },
  });
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
  return reports.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}

export const resolveReportSchema = z.object({ status: z.enum(REPORT_STATUSES), note: z.string().trim().max(1000).default("") });

export async function resolveReport(actor: User, id: string, input: z.infer<typeof resolveReportSchema>) {
  const r = await db.report.findUnique({ where: { id } });
  if (!r) throw notFound("Report");
  await db.$transaction(async (tx) => {
    await tx.report.update({ where: { id }, data: { status: input.status, resolutionNote: input.note || null, resolvedById: actor.id } });
    await audit({ actorId: actor.id, action: `report.${input.status}`, targetType: "report", targetId: id, details: { note: input.note } }, tx);
  });
}

export async function listAppeals() {
  return db.appeal.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "asc" },
    include: { enforcement: true, user: { select: { id: true, displayName: true, status: true } } },
  });
}

export const decideAppealSchema = z.object({ decision: z.enum(["accepted", "rejected"]), note: z.string().trim().min(3).max(1000) });

export async function decideAppeal(actor: User, id: string, input: z.infer<typeof decideAppealSchema>) {
  const appeal = await db.appeal.findUnique({ where: { id }, include: { enforcement: true } });
  if (!appeal) throw notFound("Appeal");
  if (appeal.status !== "open") throw new AppError("conflict", "This appeal was already decided");
  await db.$transaction(async (tx) => {
    await tx.appeal.update({ where: { id }, data: { status: input.decision, decidedById: actor.id, decisionNote: input.note } });
    if (input.decision === "accepted" && appeal.enforcement.action !== "warning") {
      await tx.user.update({ where: { id: appeal.userId }, data: { status: "active" } });
      await tx.enforcement.create({ data: { userId: appeal.userId, action: "reinstatement", reason: `Appeal accepted: ${input.note}`, actorId: actor.id } });
    }
    await audit({ actorId: actor.id, action: `appeal.${input.decision}`, targetType: "appeal", targetId: id, details: { note: input.note } }, tx);
  });
}

// ---- Billing ----

export const adjustSchema = z.object({
  userId: z.string().min(1),
  delta: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, "Amount cannot be zero"),
  reason: z.string().trim().min(5).max(500),
  requestId: z.string().min(8).max(64),
});

/** Every balance change goes through the ledger; there is no direct balance edit. */
export async function adjustCredits(actor: User, input: z.infer<typeof adjustSchema>) {
  if (!can(actor.role, "billing.adjust")) throw forbidden();
  const target = await db.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!target) throw notFound("User");
  return db.$transaction(async (tx) => {
    const { entry, replayed } = await applyLedgerEntry(tx, {
      userId: input.userId,
      delta: input.delta,
      type: "admin_adjustment",
      idempotencyKey: `admin:${actor.id}:${input.requestId}`,
      actorId: actor.id,
      note: input.reason,
    });
    if (!replayed) {
      await audit({ actorId: actor.id, action: "billing.adjust", targetType: "user", targetId: input.userId, details: { delta: input.delta, reason: input.reason, ledgerId: entry.id } }, tx);
    }
    return entry;
  });
}

export async function billingSnapshot(userId?: string) {
  const where = userId ? { userId } : {};
  const [ledger, purchases, subscriptions, events] = await Promise.all([
    db.creditLedger.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { displayName: true } } } }),
    db.purchase.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
    db.subscriptionRecord.findMany({ where, orderBy: { updatedAt: "desc" }, take: 50 }),
    userId ? Promise.resolve([]) : db.paymentEvent.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, provider: true, eventId: true, type: true, result: true, createdAt: true } }),
  ]);
  return { ledger, purchases, subscriptions, events };
}

/** Simple anomaly signals for review; not automatic enforcement. */
export async function billingAnomalies() {
  const hourAgo = new Date(Date.now() - 3600000);
  const [heavy, bigAdjustments, accounts] = await Promise.all([
    db.creditLedger.groupBy({ by: ["userId"], where: { type: "generation_charge", createdAt: { gte: hourAgo } }, _count: { _all: true }, having: { userId: { _count: { gt: 200 } } } }),
    db.creditLedger.findMany({ where: { type: "admin_adjustment", OR: [{ delta: { gt: 5000 } }, { delta: { lt: -5000 } }] }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.creditAccount.findMany({ select: { userId: true }, take: 500, orderBy: { updatedAt: "desc" } }),
  ]);
  const inconsistent = [];
  for (const a of accounts) {
    const check = await verifyLedgerConsistency(a.userId);
    if (!check.consistent) inconsistent.push({ userId: a.userId, ...check });
  }
  return {
    heavyUsageLastHour: heavy.map((h) => ({ userId: h.userId, charges: h._count._all })),
    largeAdjustments: bigAdjustments,
    negativeOrInconsistent: inconsistent,
  };
}

export async function listAudit(take = 100) {
  return db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take });
}
