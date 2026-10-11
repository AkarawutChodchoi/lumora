import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { REPORT_CATEGORIES, REPORT_TARGETS } from "../domain/enums";
import { getViewableCharacter } from "./characters";
import { severityForCategory } from "./moderation";
import { audit } from "./audit";

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1).max(60),
  category: z.enum(REPORT_CATEGORIES),
  details: z.string().trim().max(1000).default(""),
});

// Characters with this many distinct high/critical reports are hidden pending review.
const AUTO_HIDE_THRESHOLD = 3;

/** File a report. Each user can report a given target once (prevents report spam). */
export async function createReport(user: User, input: z.infer<typeof reportSchema>) {
  const snapshot = await snapshotTarget(user, input.targetType, input.targetId);
  const severity = severityForCategory(input.category);
  try {
    const report = await db.report.create({
      data: { reporterId: user.id, targetType: input.targetType, targetId: input.targetId, category: input.category, details: input.details, snapshot, severity },
    });
    if (input.targetType === "character" && (severity === "high" || severity === "critical")) await maybeAutoHide(input.targetId);
    return report;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("conflict", "You have already reported this. Our team will review it.");
    }
    throw err;
  }
}

/** Capture exactly what is being reported, verifying the reporter can actually see it. */
async function snapshotTarget(user: User, type: string, id: string): Promise<string> {
  if (type === "character") {
    const c = await getViewableCharacter(id, user);
    return JSON.stringify({ name: c.name, tagline: c.tagline, description: c.description, scenario: c.scenario, greeting: c.greeting, ownerId: c.ownerId });
  }
  if (type === "message") {
    // Users can only report messages from their own conversations.
    const m = await db.message.findUnique({ where: { id }, include: { conversation: { select: { userId: true, characterId: true } } } });
    if (!m || m.conversation.userId !== user.id) throw notFound("Message");
    return JSON.stringify({ role: m.role, content: m.content.slice(0, 4000), characterId: m.conversation.characterId });
  }
  const target = await db.user.findUnique({ where: { id }, select: { id: true, displayName: true, bio: true } });
  if (!target) throw notFound("User");
  if (target.id === user.id) throw new AppError("bad_request", "You cannot report yourself");
  return JSON.stringify(target);
}

async function maybeAutoHide(characterId: string) {
  const distinct = await db.report.count({
    where: { targetType: "character", targetId: characterId, status: { in: ["open", "reviewing"] }, severity: { in: ["high", "critical"] } },
  });
  if (distinct < AUTO_HIDE_THRESHOLD) return;
  const res = await db.character.updateMany({ where: { id: characterId, publicationStatus: "published" }, data: { publicationStatus: "hidden" } });
  if (res.count) {
    await audit({ actorId: null, action: "character.auto_hidden", targetType: "character", targetId: characterId, details: { reports: distinct } });
  }
}

export async function listMyReports(user: User) {
  return db.report.findMany({
    where: { reporterId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, targetType: true, targetId: true, category: true, status: true, createdAt: true },
  });
}

// ---- Appeals (by the affected user) ----

export const appealSchema = z.object({ enforcementId: z.string().min(1), message: z.string().trim().min(10).max(2000) });

export async function createAppeal(user: User, input: z.infer<typeof appealSchema>) {
  const enf = await db.enforcement.findUnique({ where: { id: input.enforcementId } });
  if (!enf || enf.userId !== user.id) throw notFound("Enforcement");
  const open = await db.appeal.findFirst({ where: { enforcementId: enf.id, status: "open" } });
  if (open) throw new AppError("conflict", "You already have an open appeal for this decision");
  return db.appeal.create({ data: { enforcementId: enf.id, userId: user.id, message: input.message } });
}

export async function listMyEnforcements(user: User) {
  return db.enforcement.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, action: true, reason: true, createdAt: true, expiresAt: true, appeals: { select: { id: true, status: true, decisionNote: true } } },
  });
}
