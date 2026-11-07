import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, isUniqueViolation, schema } from "@/db";
import { AppError, notFound } from "./errors";
import { REPORT_CATEGORIES, REPORT_TARGETS } from "@/lib/domain/enums";
import { getViewableCharacter } from "./characters";
import { severityForCategory } from "./moderation";
import { audit } from "./audit";
import type { AppUser } from "./access";

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1).max(60),
  category: z.enum(REPORT_CATEGORIES),
  details: z.string().trim().max(1000).default(""),
});

// Characters with this many distinct high/critical reports are hidden pending review.
const AUTO_HIDE_THRESHOLD = 3;

/** File a report. Each user can report a given target once (prevents report spam). */
export async function createReport(user: AppUser, input: z.infer<typeof reportSchema>) {
  const snapshot = await snapshotTarget(user, input.targetType, input.targetId);
  const severity = severityForCategory(input.category);
  try {
    const [report] = await db
      .insert(schema.report)
      .values({ reporterId: user.id, targetType: input.targetType, targetId: input.targetId, category: input.category, details: input.details, snapshot, severity })
      .returning();
    if (input.targetType === "character" && (severity === "high" || severity === "critical")) await maybeAutoHide(input.targetId);
    return report;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("conflict", "You have already reported this. Our team will review it.");
    throw err;
  }
}

/** Capture exactly what is being reported, verifying the reporter can actually see it. */
async function snapshotTarget(user: AppUser, type: string, id: string): Promise<string> {
  if (type === "character") {
    const c = await getViewableCharacter(id, user);
    return JSON.stringify({ name: c.name, tagline: c.tagline, description: c.description, scenario: c.scenario, greeting: c.greeting, ownerId: c.ownerId });
  }
  if (type === "message") {
    // Users can only report messages from their own conversations.
    const [m] = await db
      .select({ role: schema.message.role, content: schema.message.content, userId: schema.conversation.userId, characterId: schema.conversation.characterId })
      .from(schema.message)
      .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
      .where(eq(schema.message.id, id));
    if (!m || m.userId !== user.id) throw notFound("Message");
    return JSON.stringify({ role: m.role, content: m.content.slice(0, 4000), characterId: m.characterId });
  }
  const [target] = await db.select({ id: schema.user.id, displayName: schema.user.name, bio: schema.user.bio }).from(schema.user).where(eq(schema.user.id, id));
  if (!target) throw notFound("User");
  if (target.id === user.id) throw new AppError("bad_request", "You cannot report yourself");
  return JSON.stringify(target);
}

async function maybeAutoHide(characterId: string) {
  const r = schema.report;
  const [{ distinct }] = await db
    .select({ distinct: count() })
    .from(r)
    .where(and(eq(r.targetType, "character"), eq(r.targetId, characterId), inArray(r.status, ["open", "reviewing"]), inArray(r.severity, ["high", "critical"])));
  if (distinct < AUTO_HIDE_THRESHOLD) return;
  const res = await db
    .update(schema.character)
    .set({ publicationStatus: "hidden" })
    .where(and(eq(schema.character.id, characterId), eq(schema.character.publicationStatus, "published")))
    .returning({ id: schema.character.id });
  if (res.length) {
    await audit({ actorId: null, action: "character.auto_hidden", targetType: "character", targetId: characterId, details: { reports: distinct } });
  }
}

export async function listMyReports(user: AppUser) {
  const r = schema.report;
  return db
    .select({ id: r.id, targetType: r.targetType, targetId: r.targetId, category: r.category, status: r.status, createdAt: r.createdAt })
    .from(r)
    .where(eq(r.reporterId, user.id))
    .orderBy(desc(r.createdAt))
    .limit(50);
}

// ---- Appeals (by the affected user) ----

export const appealSchema = z.object({ enforcementId: z.string().min(1).max(60), message: z.string().trim().min(10).max(2000) });

export async function createAppeal(user: AppUser, input: z.infer<typeof appealSchema>) {
  const [enf] = await db.select().from(schema.enforcement).where(eq(schema.enforcement.id, input.enforcementId));
  if (!enf || enf.userId !== user.id) throw notFound("Enforcement");
  const [open] = await db
    .select({ id: schema.appeal.id })
    .from(schema.appeal)
    .where(and(eq(schema.appeal.enforcementId, enf.id), eq(schema.appeal.status, "open")));
  if (open) throw new AppError("conflict", "You already have an open appeal for this decision");
  const [a] = await db.insert(schema.appeal).values({ enforcementId: enf.id, userId: user.id, message: input.message }).returning();
  return a;
}

export async function listMyEnforcements(user: AppUser) {
  const e = schema.enforcement;
  const rows = await db
    .select({ id: e.id, action: e.action, reason: e.reason, createdAt: e.createdAt, expiresAt: e.expiresAt })
    .from(e)
    .where(eq(e.userId, user.id))
    .orderBy(desc(e.createdAt));
  if (!rows.length) return [];
  const appeals = await db
    .select({ id: schema.appeal.id, enforcementId: schema.appeal.enforcementId, status: schema.appeal.status, decisionNote: schema.appeal.decisionNote })
    .from(schema.appeal)
    .where(inArray(schema.appeal.enforcementId, rows.map((x) => x.id)));
  return rows.map((x) => ({ ...x, appeals: appeals.filter((a) => a.enforcementId === x.id).map(({ id, status, decisionNote }) => ({ id, status, decisionNote })) }));
}
