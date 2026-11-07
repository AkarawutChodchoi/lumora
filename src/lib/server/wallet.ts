import "server-only";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db, isUniqueViolation, schema, type Q, type Tx } from "@/db";
import { AppError } from "./errors";
import { DAILY_BONUS, SIGNUP_BONUS } from "@/lib/domain/catalog";

// Coins on the server. Server-only helpers (they take a user id, so they must never be
// callable from the browser). Same rules as Alinmanga:
// - two buckets: `paid` (bought with money) and `bonus` (promotional, spent first)
// - every change is one coin_ledger row in the same transaction as the wallet update
// - `reference` is unique: replaying an operation returns the original row, coins move once
// - spending locks the wallet row, and a CHECK constraint keeps balances >= 0

const { wallet, coinLedger } = schema;
type Kind = (typeof schema.ledgerKindEnum.enumValues)[number];
export type LedgerRow = typeof coinLedger.$inferSelect;

export type EntryInput = {
  userId: string;
  kind: Kind;
  /** positive = credit, negative = spend. Credits go to `bucket`; spends take bonus first. */
  amount: number;
  bucket?: "paid" | "bonus";
  reference: string;
  note?: string;
  actorId?: string | null;
  /** clawbacks take whatever is left instead of failing when the balance is short */
  partial?: boolean;
};

export async function ensureWallet(uid: string, tx: Q = db) {
  await tx.insert(wallet).values({ userId: uid }).onConflictDoNothing();
}

/** Apply one ledger entry inside a transaction. Idempotent by `reference`. */
export async function applyEntry(tx: Tx, input: EntryInput): Promise<{ entry: LedgerRow; replayed: boolean }> {
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new AppError("bad_request", "Invalid credit amount");
  const [existing] = await tx.select().from(coinLedger).where(eq(coinLedger.reference, input.reference));
  if (existing) return { entry: existing, replayed: true };

  await ensureWallet(input.userId, tx);
  const [w] = await tx.select().from(wallet).where(eq(wallet.userId, input.userId)).for("update");
  let paidDelta = 0;
  let bonusDelta = 0;
  if (input.amount > 0) {
    if ((input.bucket ?? "bonus") === "paid") paidDelta = input.amount;
    else bonusDelta = input.amount;
  } else {
    let cost = -input.amount;
    if (w.paid + w.bonus < cost) {
      if (!input.partial) throw new AppError("insufficient_credits", "Not enough coins for this action");
      cost = w.paid + w.bonus;
    }
    bonusDelta = -Math.min(w.bonus, cost);
    paidDelta = -(cost + bonusDelta);
  }
  const [after] = await tx
    .update(wallet)
    .set({ paid: sql`${wallet.paid} + ${paidDelta}`, bonus: sql`${wallet.bonus} + ${bonusDelta}` })
    .where(eq(wallet.userId, input.userId))
    .returning();
  return { entry: await insertRow(tx, input, paidDelta, bonusDelta, after.paid + after.bonus), replayed: false };
}

async function insertRow(tx: Tx, input: EntryInput, paidDelta: number, bonusDelta: number, balanceAfter: number) {
  const [row] = await tx
    .insert(coinLedger)
    .values({ userId: input.userId, kind: input.kind, paidDelta, bonusDelta, balanceAfter, reference: input.reference, note: input.note ?? "", actorId: input.actorId ?? null })
    .returning();
  return row;
}

/** Give back exactly what a spend took, to the same buckets. Idempotent by `reference`. */
export async function refundEntry(tx: Tx, spendReference: string, reference: string, note = "") {
  const [existing] = await tx.select().from(coinLedger).where(eq(coinLedger.reference, reference));
  if (existing) return { entry: existing, replayed: true };
  const [spend] = await tx.select().from(coinLedger).where(eq(coinLedger.reference, spendReference));
  if (!spend || spend.paidDelta + spend.bonusDelta >= 0) return null;
  await tx.select().from(wallet).where(eq(wallet.userId, spend.userId)).for("update");
  const [after] = await tx
    .update(wallet)
    .set({ paid: sql`${wallet.paid} + ${-spend.paidDelta}`, bonus: sql`${wallet.bonus} + ${-spend.bonusDelta}` })
    .where(eq(wallet.userId, spend.userId))
    .returning();
  const entry = await insertRow(tx, { userId: spend.userId, kind: "refund", amount: 1, reference, note }, -spend.paidDelta, -spend.bonusDelta, after.paid + after.bonus);
  return { entry, replayed: false };
}

/** applyEntry in its own transaction; a unique-key race counts as an idempotent replay. */
export async function postEntry(input: EntryInput) {
  try {
    return await db.transaction((tx) => applyEntry(tx, input));
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [entry] = await db.select().from(coinLedger).where(eq(coinLedger.reference, input.reference));
      if (entry) return { entry, replayed: true };
    }
    throw err;
  }
}

export async function getWallet(userId: string, tx: Q = db) {
  const [w] = await tx.select().from(wallet).where(eq(wallet.userId, userId));
  return { paid: w?.paid ?? 0, bonus: w?.bonus ?? 0, total: (w?.paid ?? 0) + (w?.bonus ?? 0) };
}

export async function getBalance(userId: string): Promise<number> {
  return (await getWallet(userId)).total;
}

/** Newest first; cursor = ledger id of the last row on the previous page. */
export async function listLedger(userId: string, cursor?: string, take = 30) {
  const c = cursor && /^\d+$/.test(cursor) ? Number(cursor) : null;
  const rows = await db
    .select()
    .from(coinLedger)
    .where(and(eq(coinLedger.userId, userId), c ? lt(coinLedger.id, c) : undefined))
    .orderBy(desc(coinLedger.id))
    .limit(take + 1);
  const items = rows.slice(0, take).map((r) => ({
    id: String(r.id),
    kind: r.kind,
    delta: r.paidDelta + r.bonusDelta,
    paidDelta: r.paidDelta,
    bonusDelta: r.bonusDelta,
    balanceAfter: r.balanceAfter,
    note: r.note,
    createdAt: r.createdAt,
  }));
  return { items, nextCursor: rows.length > take ? String(rows[take - 1].id) : null };
}

export function grantSignupBonus(tx: Tx, userId: string) {
  return applyEntry(tx, { userId, kind: "bonus", amount: SIGNUP_BONUS, reference: `signup:${userId}`, note: "โบนัสสมาชิกใหม่" });
}

/** yyyy-mm-dd in Bangkok time */
export const bangkokDay = (t = Date.now()) => new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);

/** Once per Bangkok day, enforced by the unique reference. */
export async function claimDailyBonus(userId: string, now = new Date()) {
  const { entry, replayed } = await postEntry({ userId, kind: "daily", amount: DAILY_BONUS, reference: `daily:${userId}:${bangkokDay(now.getTime())}`, note: "โบนัสรายวัน" });
  if (replayed) throw new AppError("conflict", "You already claimed today's bonus. Come back tomorrow!");
  return entry;
}

export async function dailyBonusClaimedToday(userId: string, now = new Date()) {
  const [row] = await db
    .select({ id: coinLedger.id })
    .from(coinLedger)
    .where(eq(coinLedger.reference, `daily:${userId}:${bangkokDay(now.getTime())}`));
  return Boolean(row);
}

/** Integrity check: the wallet must equal the sum of its ledger rows, bucket by bucket. */
export async function verifyLedgerConsistency(userId: string) {
  const [[w], [agg]] = await Promise.all([
    db.select().from(wallet).where(eq(wallet.userId, userId)),
    db
      .select({ paid: sql<number>`coalesce(sum(${coinLedger.paidDelta}), 0)::int`, bonus: sql<number>`coalesce(sum(${coinLedger.bonusDelta}), 0)::int` })
      .from(coinLedger)
      .where(eq(coinLedger.userId, userId)),
  ]);
  const paid = w?.paid ?? 0;
  const bonus = w?.bonus ?? 0;
  const ledgerSum = Number(agg.paid) + Number(agg.bonus);
  return { balance: paid + bonus, ledgerSum, consistent: paid === Number(agg.paid) && bonus === Number(agg.bonus) };
}
