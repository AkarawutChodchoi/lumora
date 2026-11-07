import { notFound } from "next/navigation";
import { ChatView } from "@/components/chat/chat-view";
import { pageUser } from "@/lib/server/access";
import { activeAiProvider } from "@/lib/server/config";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { listMessages } from "@/lib/server/conversations";
import { reapStaleGeneration } from "@/lib/server/chat";
import { getBalance } from "@/lib/server/wallet";
import { modelOptions, resolveModel } from "@/lib/server/ai/models";
import { pageTitle } from "@/i18n/server";

export const dynamic = "force-dynamic";
export const generateMetadata = pageTitle("chat");

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser(`/chats/${id}`);
  const { conversation: cv, character: ch } = schema;
  const [row] = await db
    .select({ conv: cv, character: { id: ch.id, name: ch.name, avatarUrl: ch.avatarUrl, tagline: ch.tagline, publicationStatus: ch.publicationStatus } })
    .from(cv)
    .innerJoin(ch, eq(ch.id, cv.characterId))
    .where(eq(cv.id, id));
  if (!row || row.conv.userId !== user.id) notFound();
  const conv = { ...row.conv, character: row.character };

  // A reply whose server worker died (e.g. the app was closed) is closed out here, not left spinning.
  const generating = conv.activeGenerationId ? await reapStaleGeneration(conv.id) : false;
  const [page, balance] = await Promise.all([listMessages(user, id, { limit: 40 }), getBalance(user.id)]);

  return (
    <ChatView
      conversation={{ id: conv.id, title: conv.title, pinned: conv.pinned, status: conv.status }}
      character={conv.character}
      initialMessages={JSON.parse(JSON.stringify(page.items))}
      initialHasMore={page.hasMore}
      initialBalance={balance}
      models={modelOptions()}
      initialModel={resolveModel(user.chatModel).id}
      devMode={activeAiProvider() === "dev"}
      generatingOnLoad={generating}
      canAct={user.status === "active"}
    />
  );
}
