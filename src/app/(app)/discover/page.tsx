import Link from "next/link";
import { Sparkles, PlusCircle } from "lucide-react";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { InstallHint } from "@/components/layout/install-hint";
import { CapsuleRow, CategoryTiles, HeroCarousel, StoreTabs } from "@/components/discover/store";
import { currentUser } from "@/server/auth/current";
import { discover, listFavorites } from "@/server/services/characters";
import { listConversations } from "@/server/services/conversations";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("discover");

export default async function DiscoverPage() {
  const user = await currentUser();
  const t = await getT();
  const [data, recent, favorites] = await Promise.all([
    discover(user),
    user ? listConversations(user) : Promise.resolve([]),
    user ? listFavorites(user) : Promise.resolve([]),
  ]);
  const spotlight = data.featured.length ? data.featured : data.trending.slice(0, 5);

  return (
    <div className="animate-fade-in">
      <InstallHint />
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{user ? t.discover.hi(user.displayName) : t.discover.guestTitle}</h1>
        <p className="mt-1 text-sm text-muted">{t.discover.subtitle}</p>
      </div>

      {!data.trending.length ? (
        <EmptyState
          icon={<Sparkles className="size-6" />}
          title={t.discover.emptyTitle}
          description={t.discover.emptyBody}
          action={
            <ButtonLink href="/characters/new">
              <PlusCircle className="size-4" /> {t.discover.create}
            </ButtonLink>
          }
        />
      ) : (
        <>
          <HeroCarousel items={JSON.parse(JSON.stringify(spotlight))} />

          {recent.length > 0 && (
            <section className="mb-10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-lg font-bold">{t.discover.continue}</h2>
                <Link href="/chats" className="text-sm text-muted hover:text-fg">
                  {t.discover.seeAll}
                </Link>
              </div>
              <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4">
                {recent.slice(0, 8).map((c) => (
                  <Link key={c.id} href={`/chats/${c.id}`} className="flex w-64 shrink-0 items-center gap-3 rounded-2xl border border-line bg-surface p-3 hover:border-line-strong">
                    <Avatar name={c.character.name} src={c.character.avatarUrl} className="size-11" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{c.title}</p>
                      <p className="truncate text-xs text-muted">{c.preview}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <CapsuleRow title={t.discover.favorites} href="/library" items={JSON.parse(JSON.stringify(favorites.slice(0, 12)))} seeAll={t.discover.seeAll} />
          <CategoryTiles />
          <CapsuleRow title={t.discover.trending} href="/search?sort=popular" items={JSON.parse(JSON.stringify(data.trending))} seeAll={t.discover.seeAll} />
          <CapsuleRow title={t.discover.newest} href="/search?sort=newest" items={JSON.parse(JSON.stringify(data.newest))} seeAll={t.discover.seeAll} />
          <StoreTabs
            lists={JSON.parse(
              JSON.stringify([
                { key: "trending", label: t.discover.tabTrending, items: data.trending },
                { key: "new", label: t.discover.tabNew, items: data.newest },
                { key: "loved", label: t.discover.tabLoved, items: data.loved },
              ]),
            )}
          />
        </>
      )}
    </div>
  );
}
