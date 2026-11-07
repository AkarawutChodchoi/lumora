import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { MemoryManager } from "@/components/memory/memory-manager";
import { pageUser } from "@/lib/server/access";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { findCharacter } from "@/lib/server/characters";
import { listMemories } from "@/lib/server/memory";
import { getEntitlements } from "@/lib/server/entitlements";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("memories");

export default async function MemoriesPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  const user = await pageUser(`/memories/${characterId}`);
  const character = await findCharacter(characterId);
  // Don't reveal private characters: only show this page if the user owns it, it isn't private, or they have chatted with it.
  const hasChat = character
    ? (await db.select({ n: count() }).from(schema.conversation).where(and(eq(schema.conversation.userId, user.id), eq(schema.conversation.characterId, characterId))))[0].n
    : 0;
  if (!character || (character.ownerId !== user.id && character.visibility === "private" && !hasChat)) notFound();
  const [items, ent, t] = await Promise.all([listMemories(user, characterId), getEntitlements(user.id), getT()]);
  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t.memory.title(character.name)}
        description={t.memory.subtitle}
      />
      <MemoryManager characterId={character.id} initial={JSON.parse(JSON.stringify(items))} charLimit={ent.memoryCharLimit} userName={user.displayName} memoryEnabled={user.memoryEnabled} />
    </div>
  );
}
