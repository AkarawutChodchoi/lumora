import "server-only";
import { and, arrayContains, count, desc, eq, ilike, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { AppError, forbidden, notFound } from "./errors";
import { can } from "@/lib/permissions";
import { CONTENT_RATINGS, VISIBILITIES } from "@/lib/domain/enums";
import { CATEGORY_KEYS } from "@/lib/domain/taxonomy";
import { moderateText } from "./moderation";
import { IMAGE_PATH } from "./images";
import { getFeatureFlags } from "./settings";
import { audit } from "./audit";
import type { AppUser } from "./access";

const { character, characterVersion, favorite, characterBlock, user: userT } = schema;
export type Character = typeof character.$inferSelect;
type Viewer = Pick<AppUser, "id" | "roles" | "ageConfirmed18" | "matureContentEnabled">;

const CATEGORY_SET = new Set<string>(CATEGORY_KEYS);
const categoryKey = z.string().refine((c) => CATEGORY_SET.has(c), "Unknown category");
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

function snapshotOf(c: Pick<Character, (typeof PROMPT_FIELDS)[number]>): CharacterSnapshot {
  const snap = {} as CharacterSnapshot;
  for (const f of PROMPT_FIELDS) snap[f] = c[f];
  return snap;
}
const sameSnapshot = (a: CharacterSnapshot, b: CharacterSnapshot) => PROMPT_FIELDS.every((f) => a[f] === b[f]);

export function parseSnapshot(raw: unknown): CharacterSnapshot {
  const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<CharacterSnapshot>;
  const snap = {} as CharacterSnapshot;
  for (const f of PROMPT_FIELDS) snap[f] = String(v?.[f] ?? "");
  return snap;
}

/** Map validated form input to database columns (arrays, primary category). */
function fieldsFor(input: CharacterInput) {
  const { categories, tags, avatarUrl, ...rest } = input;
  return { ...rest, avatarUrl: avatarUrl || null, tags: [...new Set(tags)], categories, category: categories[0] ?? "other" };
}

function assertContentAllowed(input: Pick<CharacterInput, "name" | "tagline" | "description" | "personality" | "backstory" | "scenario" | "greeting" | "exampleDialogues">) {
  const combined = [input.name, input.tagline, input.description, input.personality, input.backstory, input.scenario, input.greeting, input.exampleDialogues].join("\n");
  const result = moderateText(combined, "character");
  if (result.action === "block") throw new AppError("content_blocked", result.userMessage ?? "This character violates the content policy");
}

function assertRatingAllowed(owner: Pick<AppUser, "ageConfirmed18">, rating: string) {
  if (rating === "mature" && !owner.ageConfirmed18) {
    throw new AppError("forbidden", "Only accounts confirmed as 18+ can create mature-rated characters");
  }
}

export async function createCharacter(owner: AppUser, input: CharacterInput) {
  const flags = await getFeatureFlags();
  if (!flags.characterCreation) throw new AppError("forbidden", "Character creation is temporarily disabled");
  assertContentAllowed(input);
  assertRatingAllowed(owner, input.contentRating);
  const [{ n }] = await db.select({ n: count() }).from(character).where(eq(character.ownerId, owner.id));
  if (n >= 100) throw new AppError("conflict", "You have reached the limit of 100 characters");

  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(character)
      .values({
        ...fieldsFor(input),
        ownerId: owner.id,
        // Shared characters go live immediately; private ones start as drafts.
        publicationStatus: input.visibility === "private" ? "draft" : "published",
        currentVersion: 1,
      })
      .returning();
    await tx.insert(characterVersion).values({ characterId: c.id, version: 1, snapshot: snapshotOf(c) });
    return c;
  });
}

export async function findCharacter(id: string) {
  const [c] = await db.select().from(character).where(eq(character.id, id));
  return c ?? null;
}

async function loadOwned(user: AppUser, id: string, action: string) {
  const c = await findCharacter(id);
  if (!c) throw notFound("Character");
  if (c.ownerId !== user.id) {
    if (!can(user.roles, "characters.edit_any")) throw forbidden("Only the creator can change this character");
    await audit({ actorId: user.id, action: `character.admin_${action}`, targetType: "character", targetId: id, details: { ownerId: c.ownerId } });
  }
  return c;
}

export async function updateCharacter(user: AppUser, id: string, input: CharacterInput) {
  const existing = await loadOwned(user, id, "edit");
  assertContentAllowed(input);
  if (existing.ownerId === user.id) assertRatingAllowed(user, input.contentRating);
  if (existing.publicationStatus === "suspended" && input.visibility !== "private") {
    throw new AppError("forbidden", "This character is suspended and cannot be shared");
  }

  return db.transaction(async (tx) => {
    const next = { ...existing, ...fieldsFor(input) };
    const changed = !sameSnapshot(snapshotOf(next), snapshotOf(existing));
    const version = changed ? existing.currentVersion + 1 : existing.currentVersion;
    const [updated] = await tx
      .update(character)
      .set({
        ...fieldsFor(input),
        currentVersion: version,
        // Making a character private takes it out of discovery.
        publicationStatus: input.visibility === "private" && existing.publicationStatus === "published" ? "draft" : existing.publicationStatus,
      })
      .where(eq(character.id, id))
      .returning();
    if (changed) await tx.insert(characterVersion).values({ characterId: id, version, snapshot: snapshotOf(updated) });
    return updated;
  });
}

/** Publish to unlisted (link only) or public (discoverable). */
export async function publishCharacter(user: AppUser, id: string, visibility: "unlisted" | "public") {
  const c = await loadOwned(user, id, "publish");
  if (c.publicationStatus === "suspended" || c.publicationStatus === "hidden") {
    throw new AppError("forbidden", "This character was restricted by moderators and cannot be published");
  }
  assertContentAllowed(c);
  const [u] = await db.update(character).set({ visibility, publicationStatus: "published" }).where(eq(character.id, id)).returning();
  return u;
}

export async function unpublishCharacter(user: AppUser, id: string) {
  const c = await loadOwned(user, id, "publish");
  const [u] = await db
    .update(character)
    .set({ visibility: "private", publicationStatus: c.publicationStatus === "published" ? "draft" : c.publicationStatus })
    .where(eq(character.id, id))
    .returning();
  return u;
}

export async function deleteCharacter(user: AppUser, id: string) {
  await loadOwned(user, id, "delete");
  await db.delete(character).where(eq(character.id, id));
}

/** Whether a viewer may see the character's content rating. */
export function canSeeRating(viewer: Pick<AppUser, "ageConfirmed18" | "matureContentEnabled"> | null, rating: string) {
  if (rating !== "mature") return true;
  return Boolean(viewer?.ageConfirmed18 && viewer.matureContentEnabled);
}

export type CharacterWithOwner = Character & { owner: { id: string; displayName: string } };

const withOwner = () =>
  db
    .select({ c: character, ownerId: userT.id, ownerName: userT.name })
    .from(character)
    .innerJoin(userT, eq(userT.id, character.ownerId));
const joinOwner = (r: { c: Character; ownerId: string; ownerName: string }): CharacterWithOwner => ({ ...r.c, owner: { id: r.ownerId, displayName: r.ownerName } });

/** Central visibility rule. Returns the character or throws not_found (never reveals private existence). */
export async function getViewableCharacter(id: string, viewer: Viewer | null): Promise<CharacterWithOwner> {
  const [row] = await withOwner().where(eq(character.id, id));
  if (!row) throw notFound("Character");
  const c = joinOwner(row);
  const isOwner = viewer?.id === c.ownerId;
  const isStaff = viewer ? can(viewer.roles, "characters.moderate") : false;
  if (isOwner || isStaff) return c;
  if (c.visibility === "private") throw notFound("Character");
  if (c.publicationStatus !== "published") throw notFound("Character");
  if (!canSeeRating(viewer, c.contentRating)) throw new AppError("forbidden", "This character is rated mature. Enable mature content in settings (18+ only).");
  return c;
}

/** Whether the viewer may start a new chat with this character. */
export function assertCanStartChat(c: Character, viewer: Viewer) {
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

function publicWhere(viewer: Viewer | null): SQL[] {
  const w: SQL[] = [eq(character.visibility, "public"), eq(character.publicationStatus, "published")];
  if (!canSeeRating(viewer, "mature")) w.push(ne(character.contentRating, "mature"));
  if (viewer)
    w.push(
      notExists(
        db
          .select({ x: sql`1` })
          .from(characterBlock)
          .where(and(eq(characterBlock.characterId, character.id), eq(characterBlock.userId, viewer.id))),
      ),
    );
  return w;
}

const ORDER = {
  popular: [desc(character.chatCount), desc(character.favoriteCount), desc(character.createdAt)],
  newest: [desc(character.createdAt)],
  favorites: [desc(character.favoriteCount), desc(character.createdAt)],
} satisfies Record<CharacterSort, SQL[]>;

const PAGE_SIZE = 24;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

export async function searchCharacters(params: z.infer<typeof searchSchema>, viewer: Viewer | null) {
  const w = publicWhere(viewer);
  if (params.q) {
    const pat = `%${escapeLike(params.q)}%`;
    w.push(or(ilike(character.name, pat), ilike(character.tagline, pat), ilike(character.description, pat), sql`${params.q.toLowerCase()} = any(${character.tags})`)!);
  }
  if (params.category) w.push(arrayContains(character.categories, [params.category]));
  if (params.tag) w.push(arrayContains(character.tags, [params.tag]));
  const rows = await withOwner()
    .where(and(...w))
    .orderBy(...ORDER[params.sort])
    .offset((params.page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE + 1);
  return { items: rows.slice(0, PAGE_SIZE).map((r) => toCard(joinOwner(r))), hasMore: rows.length > PAGE_SIZE };
}

export async function discover(viewer: Viewer | null) {
  const w = publicWhere(viewer);
  const q = (extra: SQL[], order: SQL[], take: number) =>
    withOwner()
      .where(and(...w, ...extra))
      .orderBy(...order)
      .limit(take);
  const [featured, trending, newest, loved] = await Promise.all([
    q([eq(character.featured, true)], ORDER.popular, 8),
    q([], ORDER.popular, 12),
    q([], ORDER.newest, 12),
    q([], ORDER.favorites, 12),
  ]);
  const cards = (rows: typeof featured) => rows.map((r) => toCard(joinOwner(r)));
  return { featured: cards(featured), trending: cards(trending), newest: cards(newest), loved: cards(loved) };
}

export async function toggleFavorite(user: AppUser, characterId: string, fav: boolean) {
  await getViewableCharacter(characterId, user);
  await db.transaction(async (tx) => {
    if (fav) {
      const ins = await tx.insert(favorite).values({ userId: user.id, characterId }).onConflictDoNothing().returning({ u: favorite.userId });
      if (ins.length) await tx.update(character).set({ favoriteCount: sql`${character.favoriteCount} + 1` }).where(eq(character.id, characterId));
    } else {
      const del = await tx
        .delete(favorite)
        .where(and(eq(favorite.userId, user.id), eq(favorite.characterId, characterId)))
        .returning({ u: favorite.userId });
      if (del.length) await tx.update(character).set({ favoriteCount: sql`greatest(${character.favoriteCount} - 1, 0)` }).where(eq(character.id, characterId));
    }
  });
  return { favorite: fav };
}

export async function isFavorite(userId: string, characterId: string) {
  const [f] = await db
    .select({ u: favorite.userId })
    .from(favorite)
    .where(and(eq(favorite.userId, userId), eq(favorite.characterId, characterId)));
  return Boolean(f);
}

export async function isBlocked(userId: string, characterId: string) {
  const [b] = await db
    .select({ u: characterBlock.userId })
    .from(characterBlock)
    .where(and(eq(characterBlock.userId, userId), eq(characterBlock.characterId, characterId)));
  return Boolean(b);
}

export async function listFavorites(user: AppUser) {
  const rows = await db
    .select({ c: character, ownerId: userT.id, ownerName: userT.name })
    .from(favorite)
    .innerJoin(character, eq(character.id, favorite.characterId))
    .innerJoin(userT, eq(userT.id, character.ownerId))
    .where(eq(favorite.userId, user.id))
    .orderBy(desc(favorite.createdAt));
  // Drop anything that is no longer visible to this user.
  return rows
    .map(joinOwner)
    .filter((c) => c.ownerId === user.id || (c.visibility !== "private" && c.publicationStatus === "published" && canSeeRating(user, c.contentRating)))
    .map(toCard);
}

export async function listOwnCharacters(user: Pick<AppUser, "id">) {
  const rows = await withOwner().where(eq(character.ownerId, user.id)).orderBy(desc(character.updatedAt));
  return rows.map((r) => toCard(joinOwner(r)));
}

export async function setBlocked(user: AppUser, characterId: string, blocked: boolean) {
  if (!(await findCharacter(characterId))) throw notFound("Character");
  if (blocked) await db.insert(characterBlock).values({ userId: user.id, characterId }).onConflictDoNothing();
  else await db.delete(characterBlock).where(and(eq(characterBlock.userId, user.id), eq(characterBlock.characterId, characterId)));
  return { blocked };
}

export async function listBlocked(user: AppUser) {
  return db
    .select({ id: character.id, name: character.name })
    .from(characterBlock)
    .innerJoin(character, eq(character.id, characterBlock.characterId))
    .where(eq(characterBlock.userId, user.id));
}

export async function listVersions(user: AppUser, characterId: string) {
  const c = await findCharacter(characterId);
  if (!c) throw notFound("Character");
  if (c.ownerId !== user.id && !can(user.roles, "characters.moderate")) throw notFound("Character");
  return db.select().from(characterVersion).where(eq(characterVersion.characterId, characterId)).orderBy(desc(characterVersion.version));
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
    categories: c.categories.length ? c.categories : [c.category],
    tags: c.tags,
    contentRating: c.contentRating,
    visibility: c.visibility,
    publicationStatus: c.publicationStatus,
    chatCount: c.chatCount,
    favoriteCount: c.favoriteCount,
    creatorName: c.owner.displayName,
  };
}

/** Detail view. Prompt internals (personality, backstory, examples) are only shown to the creator. */
export function toDetail(c: CharacterWithOwner, viewer: Pick<AppUser, "id"> | null) {
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
