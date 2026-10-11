import { Heart, PlusCircle, Wand2 } from "lucide-react";
import { CharacterGrid } from "@/components/characters/character-card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { pageUser } from "@/server/auth/current";
import { listFavorites, listOwnCharacters } from "@/server/services/characters";
import { getT, pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("library");

export default async function LibraryPage() {
  const user = await pageUser("/library");
  const [mine, favorites, t] = await Promise.all([listOwnCharacters(user), listFavorites(user), getT()]);
  return (
    <div className="animate-fade-in space-y-12">
      <section>
        <PageHeader
          title={t.library.mine}
          description={t.library.mineSub}
          actions={
            <ButtonLink href="/characters/new" size="sm">
              <PlusCircle className="size-4" /> {t.library.new}
            </ButtonLink>
          }
        />
        {mine.length ? (
          <CharacterGrid items={mine} showStatus />
        ) : (
          <EmptyState icon={<Wand2 className="size-6" />} title={t.library.mineEmptyTitle} description={t.library.mineEmptyBody} action={<ButtonLink href="/characters/new">{t.library.create}</ButtonLink>} />
        )}
      </section>
      <section>
        <PageHeader title={t.library.favorites} description={t.library.favoritesSub} />
        {favorites.length ? (
          <CharacterGrid items={favorites} />
        ) : (
          <EmptyState icon={<Heart className="size-6" />} title={t.library.favEmptyTitle} description={t.library.favEmptyBody} />
        )}
      </section>
    </div>
  );
}
