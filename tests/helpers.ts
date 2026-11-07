import { randomUUID } from "node:crypto";
import { and, count, eq, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadAppUser, type AppUser } from "@/lib/server/access";
import { grantSignupBonus, postEntry } from "@/lib/server/wallet";
import { createCharacter, publishCharacter, type CharacterInput } from "@/lib/server/characters";
import type { Role } from "@/lib/permissions";
import type { AIProvider, GenerateRequest, StreamEvent } from "@/lib/server/ai/types";
import { ProviderError } from "@/lib/server/ai/types";

type UserOverrides = Partial<Pick<typeof schema.user.$inferInsert, "status" | "ageConfirmed18" | "matureContentEnabled" | "twoFactorEnabled" | "bannedAt" | "memoryEnabled">> & {
  roles?: Role[];
};

/**
 * A fresh account, created the way the sign-up hook does it (user row + signup bonus).
 * Staff roles get 2FA on by default so their powers are active; pass twoFactorEnabled: false to test the dormant case.
 */
export async function makeUser(overrides: UserOverrides = {}): Promise<AppUser> {
  const { roles = [], ...fields } = overrides;
  const id = randomUUID();
  await db.insert(schema.user).values({ id, email: `u-${id}@test.dev`, name: "Tester", twoFactorEnabled: roles.length > 0, ...fields });
  await db.transaction((tx) => grantSignupBonus(tx, id));
  if (roles.length) await db.insert(schema.userRole).values(roles.map((role) => ({ userId: id, role })));
  return (await loadAppUser(id))!;
}

/** Reload a user after changing them in the database. */
export const reload = async (u: { id: string }) => (await loadAppUser(u.id))!;

export async function setUser(u: { id: string }, data: Partial<typeof schema.user.$inferInsert>) {
  await db.update(schema.user).set(data).where(eq(schema.user.id, u.id));
  return reload(u);
}

export function characterInput(overrides: Partial<CharacterInput> = {}): CharacterInput {
  return {
    name: "Aria",
    tagline: "A wandering bard",
    description: "Aria sings stories of distant lands.",
    avatarUrl: null,
    personality: "Warm, curious, playful.",
    backstory: "Grew up in a lighthouse.",
    scenario: "You meet Aria at a tavern.",
    greeting: "Hello, traveler!",
    exampleDialogues: "",
    tags: ["fantasy", "music"],
    categories: ["fantasy"],
    contentRating: "general",
    visibility: "private",
    ...overrides,
  };
}

export async function makeCharacter(owner: AppUser, overrides: Partial<CharacterInput> = {}, publish?: "public" | "unlisted") {
  const c = await createCharacter(owner, characterInput(overrides));
  return publish ? publishCharacter(owner, c.id, publish) : c;
}

export const rid = () => randomUUID();

/** Scriptable provider for tests: records requests and replays chunks or errors. */
export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly isDevelopmentStub = false;
  readonly capabilities = { streaming: true, effort: true, realUsage: true };
  requests: GenerateRequest[] = [];
  constructor(
    public chunks: string[] = ["Hello ", "there!"],
    public error: ProviderError | null = null,
    public delayMs = 0,
    public stopReason: "end_turn" | "refusal" | "max_tokens" = "end_turn",
  ) {}
  async *stream(req: GenerateRequest): AsyncIterable<StreamEvent> {
    this.requests.push(req);
    for (const c of this.chunks) {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      if (req.signal?.aborted) throw new ProviderError("cancelled", "cancelled");
      yield { type: "text", text: c };
    }
    if (this.error) throw this.error;
    yield { type: "done", usage: { inputTokens: 120, outputTokens: 30 }, stopReason: this.stopReason, model: req.model };
  }
}

// ---- small query helpers for assertions ----
type T = typeof schema;
const byId = <K extends "generation" | "message" | "conversation" | "character" | "user" | "report" | "image" | "memory" | "enforcement">(k: K) => async (id: string) =>
  (await db.select().from(schema[k] as T["generation"]).where(eq((schema[k] as T["generation"]).id, id)))[0] as unknown as (T[K]["$inferSelect"] | undefined);
export const get = {
  generation: byId("generation"),
  message: byId("message"),
  conversation: byId("conversation"),
  character: byId("character"),
  user: byId("user"),
  report: byId("report"),
  image: byId("image"),
  memory: byId("memory"),
};

/** Ledger rows for one chat reply (charge, refund, fallback). */
export const genLedger = (generationId: string) =>
  db.select().from(schema.coinLedger).where(like(schema.coinLedger.reference, `gen:${generationId}:%`));

export const auditCount = async (targetId: string, action?: string | { startsWith: string }, actorId?: string) =>
  (
    await db
      .select({ n: count() })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.targetId, targetId),
          typeof action === "string" ? eq(schema.auditLog.action, action) : action ? like(schema.auditLog.action, `${action.startsWith}%`) : undefined,
          actorId ? eq(schema.auditLog.actorId, actorId) : undefined,
        ),
      )
  )[0].n;

/** Spend coins without a reason (drain a balance in tests). */
export const drain = (userId: string, amount: number) => postEntry({ userId, kind: "spend", amount: -amount, reference: `drain:${randomUUID()}` });

/** Make a generation look older than the stale-lock cutoff. */
export const ageGeneration = (id: string, ms = 5 * 60_000) => db.update(schema.generation).set({ createdAt: new Date(Date.now() - ms) }).where(eq(schema.generation.id, id));
