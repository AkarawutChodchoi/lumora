import { Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { AppError } from "../errors";
import { DAILY_BONUS, SIGNUP_BONUS } from "../domain/catalog";

export type LedgerType =
  | "signup_bonus"
  | "daily_bonus"
  | "purchase"
  | "generation_charge"
  | "generation_refund"
  | "admin_adjustment"
  | "subscription_grant"
  | "purchase_refund";

export interface LedgerEntryInput {
  userId: string;
  delta: number;
  type: LedgerType;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  actorId?: string;
  note?: string;
  /** Allow the balance to go negative (only for clawbacks such as purchase refunds). */
  allowNegative?: boolean;
}

/**
 * Apply one ledger entry and the matching balance change atomically.
 * Idempotent: replaying the same idempotencyKey returns the original entry
 * without touching the balance. Must be called inside a transaction.
 */
export async function applyLedgerEntry(tx: Tx, input: LedgerEntryInput) {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new AppError("bad_request", "Invalid credit amount");

  const existing = await tx.creditLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { entry: existing, replayed: true };

  await tx.creditAccount.upsert({ where: { userId: input.userId }, create: { userId: input.userId, balance: 0 }, update: {} });

  if (input.delta < 0 && !input.allowNegative) {
    // Conditional decrement: succeeds only when the balance covers the charge.
    // This is a single atomic UPDATE, so concurrent spends cannot overdraw.
    const res = await tx.creditAccount.updateMany({
      where: { userId: input.userId, balance: { gte: -input.delta } },
      data: { balance: { increment: input.delta } },
    });
    if (res.count !== 1) throw new AppError("insufficient_credits", "Not enough coins for this action");
  } else {
    await tx.creditAccount.update({ where: { userId: input.userId }, data: { balance: { increment: input.delta } } });
  }

  const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId: input.userId } });
  const entry = await tx.creditLedger.create({
    data: {
      userId: input.userId,
      delta: input.delta,
      balanceAfter: account.balance,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      actorId: input.actorId,
      note: input.note,
    },
  });
  return { entry, replayed: false };
}

/** Run applyLedgerEntry in its own transaction, mapping unique-key races to an idempotent replay. */
export async function postLedgerEntry(input: LedgerEntryInput) {
  try {
    return await db.$transaction((tx) => applyLedgerEntry(tx, input));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const entry = await db.creditLedger.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
      return { entry, replayed: true };
    }
    throw err;
  }
}

export async function getBalance(userId: string): Promise<number> {
  const acct = await db.creditAccount.findUnique({ where: { userId } });
  return acct?.balance ?? 0;
}

export async function listLedger(userId: string, cursor?: string, take = 30) {
  const rows = await db.creditLedger.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return { items: rows.slice(0, take), nextCursor: rows.length > take ? rows[take - 1].id : null };
}

export function grantSignupBonus(tx: Tx, userId: string) {
  return applyLedgerEntry(tx, { userId, delta: SIGNUP_BONUS, type: "signup_bonus", idempotencyKey: `signup:${userId}` });
}

/** Once per UTC day, enforced by the idempotency key. */
export async function claimDailyBonus(userId: string, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const { entry, replayed } = await postLedgerEntry({
    userId,
    delta: DAILY_BONUS,
    type: "daily_bonus",
    idempotencyKey: `daily:${userId}:${day}`,
  });
  if (replayed) throw new AppError("conflict", "You already claimed today's bonus. Come back tomorrow!");
  return entry;
}

export async function dailyBonusClaimedToday(userId: string, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const row = await db.creditLedger.findUnique({ where: { idempotencyKey: `daily:${userId}:${day}` } });
  return Boolean(row);
}

/** Integrity check: balance must equal the sum of ledger deltas. */
export async function verifyLedgerConsistency(userId: string) {
  const [acct, agg] = await Promise.all([
    db.creditAccount.findUnique({ where: { userId } }),
    db.creditLedger.aggregate({ where: { userId }, _sum: { delta: true } }),
  ]);
  const balance = acct?.balance ?? 0;
  const ledgerSum = agg._sum.delta ?? 0;
  return { balance, ledgerSum, consistent: balance === ledgerSum };
}
