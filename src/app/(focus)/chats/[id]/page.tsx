import { notFound } from "next/navigation";
import { ChatView } from "@/components/chat/chat-view";
import { pageUser } from "@/server/auth/current";
import { activeAiProvider } from "@/server/config";
import { db } from "@/server/db";
import { listMessages } from "@/server/services/conversations";
import { reapStaleGeneration } from "@/server/services/chat";
import { getBalance } from "@/server/services/credits";
import { modelOptions, resolveModel } from "@/server/ai/models";
import { pageTitle } from "@/i18n/server";

export const dynamic = "force-dynamic";
export const generateMetadata = pageTitle("chat");

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser(`/chats/${id}`);
  const conv = await db.conversation.findUnique({
    where: { id },
    include: { character: { select: { id: true, name: true, avatarUrl: true, tagline: true, publicationStatus: true } } },
  });
  if (!conv || conv.userId !== user.id) notFound();

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
