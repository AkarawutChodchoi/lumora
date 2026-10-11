import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle, Heart, ShieldAlert } from "lucide-react";
import { Avatar, Badge, ErrorState } from "@/components/ui/misc";
import { FavoriteButton, OwnerActions, StartChatButton, ViewerSafetyActions } from "@/components/characters/character-actions";
import { StaffCharacterTools } from "@/components/admin/staff-character-tools";
import { can } from "@/server/domain/permissions";
import { currentUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { getViewableCharacter, toDetail } from "@/server/services/characters";
import { listConversations } from "@/server/services/conversations";
import { db } from "@/server/db";
import { getLocale, getT } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { localizeMessage } from "@/i18n/errors";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const c = await db.character.findUnique({ where: { id }, select: { name: true, visibility: true, publicationStatus: true } });
  return { title: c && c.visibility !== "private" && c.publicationStatus === "published" ? c.name : (await getT()).titles.character };
}

export default async function CharacterPage({ params }: { params: Params }) {
  const { id } = await params;
  const viewer = await currentUser();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  let character;
  try {
    character = await getViewableCharacter(id, viewer);
  } catch (e) {
    if (e instanceof AppError && e.code === "forbidden") {
      return <ErrorState title={t.character.matureTitle} description={localizeMessage(e.message, locale)} />;
    }
    notFound();
  }
  const c = toDetail(character, viewer);
  const [fav, blocked, chats] = viewer
    ? await Promise.all([
        db.favorite.findUnique({ where: { userId_characterId: { userId: viewer.id, characterId: id } } }),
        db.characterBlock.findUnique({ where: { userId_characterId: { userId: viewer.id, characterId: id } } }),
        listConversations(viewer, id),
      ])
    : [null, null, []];
  const canChat = character.publicationStatus !== "suspended";
  const num = (n: number) => n.toLocaleString(INTL_LOCALE[locale]);
  const sectionTitle = "mb-2 text-sm font-semibold uppercase tracking-wide text-faint";

  return (
    <article className="animate-fade-in">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-line">
          <Avatar name={c.name} src={c.avatarUrl} className="aspect-[4/5] w-full text-8xl" rounded="rounded-none" />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {c.categories.map((cat) => (
              <Link key={cat} href={`/search?category=${cat}`}>
                <Badge tone="accent">{t.enums.category[cat] ?? cat}</Badge>
              </Link>
            ))}
            {c.contentRating !== "general" && <Badge tone={c.contentRating === "mature" ? "danger" : "warn"}>{t.enums.rating[c.contentRating]}</Badge>}
            {c.isOwner && <Badge>{t.enums.visibility[c.visibility]}</Badge>}
            {c.isOwner && c.publicationStatus !== "published" && <Badge tone={c.publicationStatus === "draft" ? "neutral" : "danger"}>{t.enums.publication[c.publicationStatus]}</Badge>}
          </div>
          <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{c.name}</h1>
          {c.tagline && <p className="mt-2 text-lg text-muted">{c.tagline}</p>}
          <p className="mt-3 flex flex-wrap items-center gap-4 text-sm text-faint">
            <span>{t.common.by(c.creatorName)}</span>
            <span className="flex items-center gap-1">
              <MessageCircle className="size-4" /> {t.character.chatsCount(num(c.chatCount))}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="size-4" /> {num(c.favoriteCount)}
            </span>
          </p>

          <div className="mt-6 flex gap-2">
            <StartChatButton characterId={c.id} signedIn={Boolean(viewer)} disabled={!canChat || Boolean(blocked)} />
            {viewer && <FavoriteButton characterId={c.id} initial={Boolean(fav)} />}
          </div>
          {blocked && <p className="mt-2 text-xs text-warn">{t.character.blockedNote}</p>}

          {c.isOwner && (
            <div className="mt-6">
              <OwnerActions characterId={c.id} visibility={c.visibility} publicationStatus={c.publicationStatus} />
            </div>
          )}

          {viewer && !c.isOwner && can(viewer.role, "characters.moderate") && (
            <div className="mt-6">
              <StaffCharacterTools
                characterId={c.id}
                publicationStatus={character.publicationStatus}
                visibility={character.visibility}
                featured={character.featured}
                canEditAny={can(viewer.role, "characters.edit_any")}
              />
            </div>
          )}

          {c.description && (
            <section className="mt-8">
              <h2 className={sectionTitle}>{t.character.about}</h2>
              <p className="whitespace-pre-line leading-relaxed text-fg/90">{c.description}</p>
            </section>
          )}
          {c.scenario && (
            <section className="mt-6">
              <h2 className={sectionTitle}>{t.character.scenario}</h2>
              <p className="whitespace-pre-line leading-relaxed text-muted">{c.scenario}</p>
            </section>
          )}
          <section className="mt-6">
            <h2 className={sectionTitle}>{t.character.firstMessage}</h2>
            <div className="max-w-xl rounded-2xl rounded-tl-md border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed whitespace-pre-line">{c.greeting}</div>
          </section>
          {c.tags.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {c.tags.map((tag) => (
                <Link key={tag} href={`/search?tag=${encodeURIComponent(tag)}`} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-fg">
                  #{t.enums.tag[tag] ?? tag}
                </Link>
              ))}
            </div>
          )}

          {chats.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-faint">{t.character.yourChats(c.name)}</h2>
              <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                {chats.map((ch) => (
                  <li key={ch.id}>
                    <Link href={`/chats/${ch.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{ch.title}</span>
                        <span className="block truncate text-xs text-faint">{ch.preview}</span>
                      </span>
                      <time className="shrink-0 text-xs text-faint">{new Date(ch.lastMessageAt).toLocaleDateString(INTL_LOCALE[locale])}</time>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {viewer && !c.isOwner && (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <span className="flex items-center gap-1.5 text-xs text-faint">
                <ShieldAlert className="size-4" /> {t.character.fictional}
              </span>
              <ViewerSafetyActions characterId={c.id} blocked={Boolean(blocked)} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
