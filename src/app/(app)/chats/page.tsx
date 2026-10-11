import { MessageCircle } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ChatList } from "@/components/chat/chat-list";
import { ButtonLink } from "@/components/ui/button";
import { pageUser } from "@/server/auth/current";
import { listConversations } from "@/server/services/conversations";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("chats");

export default async function ChatsPage() {
  const user = await pageUser("/chats");
  const items = await listConversations(user);
  const t = await getT();
  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      {items.length === 0 ? (
        <>
        <PageHeader title={t.titles.chats} />
        <EmptyState
          icon={<MessageCircle className="size-6" />}
          title={t.chats.emptyTitle}
          description={t.chats.emptyBody}
          action={<ButtonLink href="/discover">{t.chats.discover}</ButtonLink>}
        />
        </>
      ) : (
        <ChatList items={JSON.parse(JSON.stringify(items))} />
      )}
    </div>
  );
}
