import type { Character, Prisma, User } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { AppError, forbidden, notFound } from "../errors";
import { can } from "../domain/permissions";
import { CONTENT_RATINGS, VISIBILITIES } from "../domain/enums";
import { CATEGORY_KEYS } from "../domain/taxonomy";

const CATEGORY_SET = new Set<string>(CATEGORY_KEYS);
const categoryKey = z.string().refine((c) => CATEGORY_SET.has(c), "Unknown category");
import { moderateText } from "./moderation";
import { IMAGE_PATH } from "./images";
import { getFeatureFlags } from "./settings";
import { audit } from "./audit";

const text = (max: number) => z.string().trim().max(max);

export const characterInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  tagline: text(120).default(""),
  description: text(2000).default(""),
  avatarUrl: z.union([z.string().trim().regex(IMAGE_PATH), z.string().trim().url().startsWith("https://", "Image must be an https URL").max(500), z.literal(""), z.null()]).default(null),
  personality: text(4000).default(""),
  backstory: text(6000).default(""),
  scenario: text(3000).default(""),
  greeting: z.string().trim().min(1, "A greeting message is required").max(2000),
  exampleDialogues: text(4000).default(""),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(24)).max(8).default([]),
  categories: z
    .array(categoryKey)
    .min(1, "Choose at least one category")
    .max(10, "Choose up to 10 categories")
    .default(["other"])
    .transform((c) => [...new Set(c)]),
  contentRating: z.enum(CONTENT_RATINGS).default("general"),
  visibility: z.enum(VISIBILITIES).default("private"),
});
export type CharacterInput = z.infer<typeof characterInputSchema>;

/** Fields that shape the AI prompt; changing any of them creates a new version. */
const PROMPT_FIELDS = ["name", "personality", "backstory", "scenario", "greeting", "exampleDialogues", "description"] as const;
export type CharacterSnapshot = Pick<Character, (typeof PROMPT_FIELDS)[number]>;

function snapshotOf(c: Pick<Character, (typeof PROMPT_FIELDS)[number]>): string {
  const snap: Record<string, string> = {};
  for (const f of PROMPT_FIELDS) snap[f] = c[f];
  return JSON.stringify(snap);
}

export function parseSnapshot(raw: string): CharacterSnapshot {
  return JSON.parse(raw) as CharacterSnapshot;
}

export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** Map validated form input to database columns (JSON arrays, primary category). */
function fieldsFor(input: CharacterInput) {
  const { categories, tags, avatarUrl, ...rest } = input;
  return {
    ...rest,
    avatarUrl: avatarUrl || null,
    tags: JSON.stringify([...new Set(tags)]),
    categories: JSON.stringify(categories),
    category: categories[0] ?? "other",
  };
}

function assertContentAllowed(input: CharacterInput) {
  const combined = [input.name, input.tagline, input.description, input.personality, input.backstory, input.scenario, input.greeting, input.exampleDialogues].join("\n");
  const result = moderateText(combined, "character");
  if (result.action === "block") throw new AppError("content_blocked", result.userMessage ?? "This character violates the content policy");
}

function assertRatingAllowed(owner: User, rating: string) {
  if (rating === "mature" && !owner.ageConfirmed18) {
    throw new AppError("forbidden", "Only accounts confirmed as 18+ can create mature-rated characters");
  }
}

export async function createCharacter(owner: User, input: CharacterInput) {
  const flags = await getFeatureFlags();
  if (!flags.characterCreation) throw new AppError("forbidden", "Character creation is temporarily disabled");
  assertContentAllowed(input);
  assertRatingAllowed(owner, input.contentRating);
  const count = await db.character.count({ where: { ownerId: owner.id } });
  if (count >= 100) throw new AppError("conflict", "You have reached the limit of 100 characters");

  return db.$transaction(async (tx) => {
    const character = await tx.character.create({
      data: {
        ...fieldsFor(input),
        ownerId: owner.id,
        // Shared characters go live immediately; private ones start as drafts.
        publicationStatus: input.visibility === "private" ? "draft" : "published",
        currentVersion: 1,
      },
    });
    await tx.characterVersion.create({ data: { characterId: character.id, version: 1, snapshot: snapshotOf(character) } });
    return character;
  });
}

async function loadOwned(user: User, id: string, action: string) {
  const character = await db.character.findUnique({ where: { id } });
  if (!character) throw notFound("Character");
  if (character.ownerId !== user.id) {
    if (!can(user.role, "characters.edit_any")) throw forbidden("Only the creator can change this character");
    await audit({ actorId: user.id, action: `character.admin_${action}`, targetType: "character", targetId: id, details: { ownerId: character.ownerId } });
  }
  return character;
}

export async function updateCharacter(user: User, id: string, input: CharacterInput) {
  const existing = await loadOwned(user, id, "edit");
  assertContentAllowed(input);
  if (existing.ownerId === user.id) assertRatingAllowed(user, input.contentRating);
  if (existing.publicationStatus === "suspended" && input.visibility !== "private") {
    throw new AppError("forbidden", "This character is suspended and cannot be shared");
  }

  return db.$transaction(async (tx) => {
    const next = { ...existing, ...fieldsFor(input) };
    const changed = snapshotOf(next) !== snapshotOf(existing);
    const version = changed ? existing.currentVersion + 1 : existing.currentVersion;
    const updated = await tx.character.update({
      where: { id },
      data: {
        ...fieldsFor(input),
        currentVersion: version,
        // Making a character private takes it out of discovery.
        publicationStatus: input.visibility === "private" && existing.publicationStatus === "published" ? "draft" : existing.publicationStatus,
      },
    });
    if (changed) await tx.characterVersion.create({ data: { characterId: id, version, snapshot: snapshotOf(updated) } });
    return updated;
  });
}

/** Publish to unlisted (link only) or public (discoverable). */
export async function publishCharacter(user: User, id: string, visibility: "unlisted" | "public") {
  const c = await loadOwned(user, id, "publish");
  if (c.publicationStatus === "suspended" || c.publicationStatus === "hidden") {
    throw new AppError("forbidden", "This character was restricted by moderators and cannot be published");
  }
  assertContentAllowed({
    ...c,
    tags: parseTags(c.tags),
    categories: parseTags(c.categories) as CharacterInput["categories"],
    contentRating: c.contentRating as CharacterInput["contentRating"],
    visibility,
  });
  return db.character.update({ where: { id }, data: { visibility, publicationStatus: "published" } });
}

export async function unpublishCharacter(user: User, id: string) {
  const c = await loadOwned(user, id, "publish");
  return db.character.update({ where: { id }, data: { visibility: "private", publicationStatus: c.publicationStatus === "published" ? "draft" : c.publicationStatus } });
}

export async function deleteCharacter(user: User, id: string) {
  await loadOwned(user, id, "delete");
  await db.character.delete({ where: { id } });
}

/** Whether a viewer may see the character's content rating. */
export function canSeeRating(viewer: Pick<User, "ageConfirmed18" | "matureContentEnabled"> | null, rating: string) {
  if (rating !== "mature") return true;
  return Boolean(viewer?.ageConfirmed18 && viewer.matureContentEnabled);
}

/** Central visibility rule. Returns the character or throws not_found (never reveals private existence). */
export async function getViewableCharacter(id: string, viewer: User | null) {
  const c = await db.character.findUnique({ where: { id }, include: { owner: { select: { id: true, displayName: true } } } });
  if (!c) throw notFound("Character");
  const isOwner = viewer?.id === c.ownerId;
  const isStaff = viewer ? can(viewer.role, "characters.moderate") : false;
  if (isOwner || isStaff) return c;
  if (c.visibility === "private") throw notFound("Character");
  if (c.publicationStatus !== "published") throw notFound("Character");
  if (!canSeeRating(viewer, c.contentRating)) throw new AppError("forbidden", "This character is rated mature. Enable mature content in settings (18+ only).");
  return c;
}

/** Whether the viewer may start a new chat with this character. */
export function assertCanStartChat(c: Character, viewer: User) {
  if (c.publicationStatus === "suspended" || c.publicationStatus === "hidden") {
    if (c.ownerId !== viewer.id || c.publicationStatus === "suspended") {
      throw new AppError("forbidden", "This character is not available for new chats");
    }
  }
  if (!canSeeRating(viewer, c.contentRating) && c.ownerId !== viewer.id) {
    throw new AppError("forbidden", "This character is rated mature (18+ only)");
  }
}

export type CharacterSort = "popular" | "newest" | "favorites";

export const searchSchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: categoryKey.optional(),
  tag: z.string().trim().toLowerCase().max(24).optional(),
  sort: z.enum(["popular", "newest", "favorites"]).default("popular"),
  page: z.coerce.number().int().min(1).max(100).default(1),
});

function publicWhere(viewer: User | null): Prisma.CharacterWhereInput {
  const where: Prisma.CharacterWhereInput = { visibility: "public", publicationStatus: "published" };
  const and: Prisma.CharacterWhereInput[] = [];
  if (!canSeeRating(viewer, "mature")) and.push({ contentRating: { not: "mature" } });
  if (viewer) and.push({ blocks: { none: { userId: viewer.id } } });
  return and.length ? { ...where, AND: and } : where;
}

const ORDER: Record<CharacterSort, Prisma.CharacterOrderByWithRelationInput[]> = {
  popular: [{ chatCount: "desc" }, { favoriteCount: "desc" }, { createdAt: "desc" }],
  newest: [{ createdAt: "desc" }],
  favorites: [{ favoriteCount: "desc" }, { createdAt: "desc" }],
};

const PAGE_SIZE = 24;

export async function searchCharacters(params: z.infer<typeof searchSchema>, viewer: User | null) {
  const and: Prisma.CharacterWhereInput[] = [];
  if (params.q) {
    and.push({
      OR: [
        { name: { contains: params.q, mode: "insensitive" } },
        { tagline: { contains: params.q, mode: "insensitive" } },
        { description: { contains: params.q, mode: "insensitive" } },
        { tags: { contains: params.q.toLowerCase() } },
      ],
    });
  }
  if (params.category) and.push({ categories: { contains: `"${params.category}"` } });
  if (params.tag) and.push({ tags: { contains: `"${params.tag}"` } });
  const base = publicWhere(viewer);
  const where: Prisma.CharacterWhereInput = { ...base, AND: [...((base.AND as Prisma.CharacterWhereInput[]) ?? []), ...and] };
  const rows = await db.character.findMany({
    where,
    orderBy: ORDER[params.sort],
    skip: (params.page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
    include: { owner: { select: { displayName: true } } },
  });
  return { items: rows.slice(0, PAGE_SIZE).map(toCard), hasMore: rows.length > PAGE_SIZE };
}

export async function discover(viewer: User | null) {
  const where = publicWhere(viewer);
  const include = { owner: { select: { displayName: true } } } as const;
  const [featured, trending, newest, loved] = await Promise.all([
    db.character.findMany({ where: { ...where, featured: true }, orderBy: ORDER.popular, take: 8, include }),
    db.character.findMany({ where, orderBy: ORDER.popular, take: 12, include }),
    db.character.findMany({ where, orderBy: ORDER.newest, take: 12, include }),
    db.character.findMany({ where, orderBy: ORDER.favorites, take: 12, include }),
  ]);
  return { featured: featured.map(toCard), trending: trending.map(toCard), newest: newest.map(toCard), loved: loved.map(toCard) };
}

export async function toggleFavorite(user: User, characterId: string, favorite: boolean) {
  await getViewableCharacter(characterId, user);
  const key = { userId_characterId: { userId: user.id, characterId } };
  const exists = await db.favorite.findUnique({ where: key });
  if (favorite && !exists) {
    await db.$transaction([
      db.favorite.create({ data: { userId: user.id, characterId } }),
      db.character.update({ where: { id: characterId }, data: { favoriteCount: { increment: 1 } } }),
    ]);
  } else if (!favorite && exists) {
    await db.$transaction([
      db.favorite.delete({ where: key }),
      db.character.update({ where: { id: characterId }, data: { favoriteCount: { decrement: 1 } } }),
    ]);
  }
  return { favorite };
}

export async function listFavorites(user: User) {
  const rows = await db.favorite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { character: { include: { owner: { select: { displayName: true } } } } },
  });
  // Drop anything that is no longer visible to this user.
  return rows
    .map((r) => r.character)
    .filter((c) => c.ownerId === user.id || (c.visibility !== "private" && c.publicationStatus === "published" && canSeeRating(user, c.contentRating)))
    .map(toCard);
}

export async function listOwnCharacters(user: User) {
  const rows = await db.character.findMany({ where: { ownerId: user.id }, orderBy: { updatedAt: "desc" }, include: { owner: { select: { displayName: true } } } });
  return rows.map(toCard);
}

export async function setBlocked(user: User, characterId: string, blocked: boolean) {
  const c = await db.character.findUnique({ where: { id: characterId } });
  if (!c) throw notFound("Character");
  const key = { userId_characterId: { userId: user.id, characterId } };
  if (blocked) await db.characterBlock.upsert({ where: key, create: { userId: user.id, characterId }, update: {} });
  else await db.characterBlock.deleteMany({ where: { userId: user.id, characterId } });
  return { blocked };
}

export async function listBlocked(user: User) {
  const rows = await db.characterBlock.findMany({ where: { userId: user.id }, include: { character: { select: { id: true, name: true } } } });
  return rows.map((r) => r.character);
}

export async function listVersions(user: User, characterId: string) {
  const c = await db.character.findUnique({ where: { id: characterId } });
  if (!c) throw notFound("Character");
  if (c.ownerId !== user.id && !can(user.role, "characters.moderate")) throw notFound("Character");
  return db.characterVersion.findMany({ where: { characterId }, orderBy: { version: "desc" } });
}

export interface CharacterCard {
  id: string;
  name: string;
  tagline: string;
  avatarUrl: string | null;
  category: string;
  categories: string[];
  tags: string[];
  contentRating: string;
  visibility: string;
  publicationStatus: string;
  chatCount: number;
  favoriteCount: number;
  creatorName: string;
}

export function toCard(c: Character & { owner: { displayName: string } }): CharacterCard {
  return {
    id: c.id,
    name: c.name,
    tagline: c.tagline,
    avatarUrl: c.avatarUrl,
    category: c.category,
    categories: parseTags(c.categories).length ? parseTags(c.categories) : [c.category],
    tags: parseTags(c.tags),
    contentRating: c.contentRating,
    visibility: c.visibility,
    publicationStatus: c.publicationStatus,
    chatCount: c.chatCount,
    favoriteCount: c.favoriteCount,
    creatorName: c.owner.displayName,
  };
}

/** Detail view. Prompt internals (personality, backstory, examples) are only shown to the creator. */
export function toDetail(c: Character & { owner: { id: string; displayName: string } }, viewer: User | null) {
  const isOwner = viewer?.id === c.ownerId;
  return {
    ...toCard(c),
    description: c.description,
    scenario: c.scenario,
    greeting: c.greeting,
    isOwner,
    creatorId: c.ownerId,
    currentVersion: c.currentVersion,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    ...(isOwner ? { personality: c.personality, backstory: c.backstory, exampleDialogues: c.exampleDialogues } : {}),
  };
}
