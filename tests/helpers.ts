import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { db } from "@/server/db";
import { registerUser } from "@/server/services/users";
import { createCharacter, publishCharacter, type CharacterInput } from "@/server/services/characters";
import type { AIProvider, GenerateRequest, StreamEvent } from "@/server/ai/types";
import { ProviderError } from "@/server/ai/types";

export async function makeUser(overrides: Partial<Pick<User, "role" | "status" | "ageConfirmed18" | "matureContentEnabled">> = {}) {
  const user = await registerUser({
    email: `u-${randomUUID()}@test.dev`,
    password: "password123",
    displayName: "Tester",
    ageConfirmed: true,
  });
  return Object.keys(overrides).length ? db.user.update({ where: { id: user.id }, data: overrides }) : user;
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

export async function makeCharacter(owner: User, overrides: Partial<CharacterInput> = {}, publish?: "public" | "unlisted") {
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
